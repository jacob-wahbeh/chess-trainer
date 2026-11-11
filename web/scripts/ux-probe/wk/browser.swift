// A minimal, long-lived WebKit "browser" for measuring the app at iPhone size from inside the command sandbox
// (Chrome can't start there). Commands arrive as JSON files in /tmp/ux-probe/cmd (written by wk.mjs):
//   js    {code}            run an async function body in the page, return its value
//   click {x, y}            a real (trusted) left click at CSS px, via NSEvents into the WKWebView
//   move  {x, y}            mouse move (to clear :hover)
//   snap  {path, width, rect?} PNG of the viewport (or rect), scaled to `width` pixels
//   load  {url}             navigate and wait for didFinish
//   quit
import Cocoa
import WebKit

let W: CGFloat = 393, H: CGFloat = 852
let CMD_DIR = "/tmp/ux-probe/cmd"
let LOG = "/tmp/ux-probe/console.log"
let UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1"

func appendLog(_ s: String) {
	let line = "[\(ISO8601DateFormatter().string(from: Date()))] \(s)\n"
	if let h = FileHandle(forWritingAtPath: LOG) {
		h.seekToEndOfFile()
		h.write(line.data(using: .utf8)!)
		h.closeFile()
	} else {
		FileManager.default.createFile(atPath: LOG, contents: line.data(using: .utf8))
	}
}

func sanitize(_ v: Any?) -> Any {
	guard let v = v else { return NSNull() }
	if v is NSNull || v is String || v is NSNumber { return v }
	if let a = v as? [Any] { return a.map { sanitize($0) } }
	if let d = v as? [String: Any] { return d.mapValues { sanitize($0) } }
	return String(describing: v)
}

final class Browser: NSObject, WKNavigationDelegate, WKScriptMessageHandler, WKUIDelegate {
	let web: WKWebView
	let win: NSWindow
	var busy = false
	var pendingLoad: ((Any) -> Void)?

	override init() {
		let cfg = WKWebViewConfiguration()
		// In-memory storage: nothing persists outside this process (IndexedDB, localStorage live in RAM).
		cfg.websiteDataStore = .nonPersistent()
		let ucc = WKUserContentController()
		let early = """
		(() => {
		  const css = ':root{--safe-t:59px !important;--safe-b:34px !important;} ::-webkit-scrollbar{display:none !important;width:0 !important;height:0 !important;}';
		  const add = () => { if (document.getElementById('ux-probe-safe')) return; const s = document.createElement('style'); s.id = 'ux-probe-safe'; s.textContent = css; (document.head || document.documentElement).appendChild(s); };
		  add(); document.addEventListener('DOMContentLoaded', add);
		  try { Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true, configurable: true }); } catch (e) {}
		  const post = (k, m) => { try { webkit.messageHandlers.probe.postMessage(k + ': ' + m); } catch (e) {} };
		  addEventListener('error', e => post('error', e.message + ' @' + e.filename + ':' + e.lineno));
		  addEventListener('unhandledrejection', e => post('rejection', String(e.reason && (e.reason.stack || e.reason))));
		  for (const k of ['error', 'warn']) { const f = console[k]; console[k] = (...a) => { post('console.' + k, a.map(x => { try { return typeof x === 'string' ? x : (x && x.stack) || JSON.stringify(x); } catch (e) { return String(x); } }).join(' ')); f.apply(console, a); }; }
		})();
		"""
		ucc.addUserScript(WKUserScript(source: early, injectionTime: .atDocumentStart, forMainFrameOnly: true))
		cfg.userContentController = ucc
		web = WKWebView(frame: NSRect(x: 0, y: 0, width: W, height: H), configuration: cfg)
		win = NSWindow(contentRect: NSRect(x: -7000, y: -7000, width: W, height: H), styleMask: [.borderless], backing: .buffered, defer: false)
		super.init()
		ucc.add(self, name: "probe")
		web.customUserAgent = UA
		web.navigationDelegate = self
		web.uiDelegate = self
		win.contentView = web
		// Offscreen window: keep WebKit treating the page as visible (rAF, timers, painting).
		if web.responds(to: Selector(("_setWindowOcclusionDetectionEnabled:"))) {
			web.setValue(false, forKey: "windowOcclusionDetectionEnabled")
		}
		win.orderFrontRegardless()
	}

	func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
		appendLog("\(m.body)")
	}

	func webView(_ w: WKWebView, didFinish n: WKNavigation!) {
		pendingLoad?(["ok": true, "url": w.url?.absoluteString ?? ""])
		pendingLoad = nil
	}

	func webView(_ w: WKWebView, didFail n: WKNavigation!, withError e: Error) {
		appendLog("didFail \(e)")
		pendingLoad?(["error": "\(e)"])
		pendingLoad = nil
	}

	func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) {
		appendLog("didFailProvisional \(e)")
		pendingLoad?(["error": "\(e)"])
		pendingLoad = nil
	}

	func webViewWebContentProcessDidTerminate(_ w: WKWebView) {
		appendLog("WEB CONTENT PROCESS TERMINATED")
	}

	func webView(_ w: WKWebView, createWebViewWith c: WKWebViewConfiguration, for a: WKNavigationAction, windowFeatures f: WKWindowFeatures) -> WKWebView? {
		appendLog("blocked window.open \(a.request.url?.absoluteString ?? "")")
		return nil
	}

	func mouse(_ type: NSEvent.EventType, _ x: CGFloat, _ y: CGFloat, _ t: TimeInterval) -> NSEvent? {
		NSEvent.mouseEvent(
			with: type, location: NSPoint(x: x, y: H - y), modifierFlags: [], timestamp: t,
			windowNumber: win.windowNumber, context: nil, eventNumber: 0, clickCount: 1,
			pressure: type == .leftMouseDown ? 1 : 0)
	}

	func handle(_ c: [String: Any], _ done: @escaping (Any) -> Void) {
		let type = c["type"] as? String ?? ""
		switch type {
		case "js":
			let code = c["code"] as? String ?? "return null"
			web.callAsyncJavaScript(code, arguments: [:], in: nil, in: .page) { r in
				switch r {
				case .success(let v): done(sanitize(v))
				case .failure(let e):
					let ns = e as NSError
					done(["error": "\(ns.localizedDescription) \(ns.userInfo["WKJavaScriptExceptionMessage"] ?? "") line \(ns.userInfo["WKJavaScriptExceptionLineNumber"] ?? "")"])
				}
			}
		case "click":
			let x = CGFloat((c["x"] as? NSNumber)?.doubleValue ?? 0), y = CGFloat((c["y"] as? NSNumber)?.doubleValue ?? 0)
			let t = ProcessInfo.processInfo.systemUptime
			guard let down = mouse(.leftMouseDown, x, y, t), let up = mouse(.leftMouseUp, x, y, t + 0.06) else {
				done(["error": "event"])
				return
			}
			web.mouseDown(with: down)
			DispatchQueue.main.asyncAfter(deadline: .now() + 0.06) {
				self.web.mouseUp(with: up)
				DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) { done(["ok": true]) }
			}
		case "move":
			let x = CGFloat((c["x"] as? NSNumber)?.doubleValue ?? 0), y = CGFloat((c["y"] as? NSNumber)?.doubleValue ?? 0)
			if let ev = mouse(.mouseMoved, x, y, ProcessInfo.processInfo.systemUptime) { web.mouseMoved(with: ev) }
			DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { done(["ok": true]) }
		case "snap":
			let path = c["path"] as? String ?? "/tmp/ux-probe/shot.png"
			let widthPx = (c["width"] as? NSNumber)?.intValue ?? 1179
			let conf = WKSnapshotConfiguration()
			if let r = c["rect"] as? [NSNumber], r.count == 4 {
				conf.rect = NSRect(x: r[0].doubleValue, y: r[1].doubleValue, width: r[2].doubleValue, height: r[3].doubleValue)
			} else {
				conf.rect = NSRect(x: 0, y: 0, width: W, height: H)
			}
			conf.snapshotWidth = NSNumber(value: widthPx)
			conf.afterScreenUpdates = true
			web.takeSnapshot(with: conf) { img, err in
				guard let img = img else {
					done(["error": "\(String(describing: err))"])
					return
				}
				let pxW = widthPx, pxH = Int((conf.rect.height / conf.rect.width * CGFloat(widthPx)).rounded())
				let rep = NSBitmapImageRep(
					bitmapDataPlanes: nil, pixelsWide: pxW, pixelsHigh: pxH, bitsPerSample: 8, samplesPerPixel: 4,
					hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
				rep.size = NSSize(width: pxW, height: pxH)
				NSGraphicsContext.saveGraphicsState()
				NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
				NSGraphicsContext.current?.imageInterpolation = .high
				img.draw(in: NSRect(x: 0, y: 0, width: pxW, height: pxH))
				NSGraphicsContext.restoreGraphicsState()
				if let png = rep.representation(using: .png, properties: [:]) {
					try? png.write(to: URL(fileURLWithPath: path))
				}
				done(["ok": true, "w": pxW, "h": pxH])
			}
		case "load":
			let url = c["url"] as? String ?? "about:blank"
			pendingLoad = done
			web.load(URLRequest(url: URL(string: url)!))
		case "quit":
			done(["ok": true])
			DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { exit(0) }
		default:
			done(["error": "unknown command \(type)"])
		}
	}

	func poll() {
		if busy { return }
		guard let files = try? FileManager.default.contentsOfDirectory(atPath: CMD_DIR) else { return }
		guard let f = files.filter({ $0.hasSuffix(".cmd.json") }).sorted().first else { return }
		let path = CMD_DIR + "/" + f
		let data = FileManager.default.contents(atPath: path)
		try? FileManager.default.removeItem(atPath: path)
		let id = String(f.dropLast(".cmd.json".count))
		guard let d = data, let obj = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { return }
		busy = true
		handle(obj) { result in
			let out = CMD_DIR + "/" + id + ".res.json"
			let payload = (try? JSONSerialization.data(withJSONObject: ["result": result])) ?? Data("{\"result\":\"<unserializable>\"}".utf8)
			FileManager.default.createFile(atPath: out + ".tmp", contents: payload)
			try? FileManager.default.moveItem(atPath: out + ".tmp", toPath: out)
			self.busy = false
		}
	}
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
try? FileManager.default.createDirectory(atPath: CMD_DIR, withIntermediateDirectories: true)
let browser = Browser()
Timer.scheduledTimer(withTimeInterval: 0.04, repeats: true) { _ in browser.poll() }
if CommandLine.arguments.count > 1, let u = URL(string: CommandLine.arguments[1]) { browser.web.load(URLRequest(url: u)) }
appendLog("browser started")
app.run()
