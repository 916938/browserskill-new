export const USER_TAB_OBSERVE = "bsk.user-tab.observe";
export const OBSERVE_MAX_BYTES = 16000;

export interface UserTabObserveMessage {
  type: typeof USER_TAB_OBSERVE;
  expected_origin: string;
  max_chars: number;
}

// 独立只读通道：不读取表单值、链接属性、存储或网络，不支持 shadow tree。
export function observeUserTab(raw: unknown, doc: Document = document) {
  const p = raw as Partial<UserTabObserveMessage> | null;
  if (
    !p ||
    typeof p !== "object" ||
    Array.isArray(p) ||
    Object.keys(p).some((key) => !["type", "expected_origin", "max_chars"].includes(key)) ||
    p.type !== USER_TAB_OBSERVE ||
    typeof p.expected_origin !== "string" ||
    !Number.isSafeInteger(p.max_chars) ||
    p.max_chars! < 1 ||
    p.max_chars! > 8000
  )
    return { code: "invalid_params", message: "invalid read-only observation params" };
  try {
    const expected = new URL(p.expected_origin);
    if (!["http:", "https:"].includes(expected.protocol) || expected.origin !== p.expected_origin) {
      return { code: "invalid_params", message: "expected_origin must be an HTTP(S) origin only" };
    }
  } catch {
    return { code: "invalid_params", message: "invalid expected_origin" };
  }
  const win = doc.defaultView;
  if (!win || win.top !== win || win.location.origin !== p.expected_origin) {
    return { code: "permission_denied", message: "document origin mismatch" };
  }
  const origin = win.location.origin;
  const start = performance.now();
  let nodes = 0;
  let chars = 0;
  let bytes = 0;
  let text = "";
  let truncated = false;
  const stop = Symbol();
  const encoder = new TextEncoder();
  const budget = () => {
    if (performance.now() - start >= 50 || nodes >= 5000) {
      truncated = true;
      throw stop;
    }
  };
  const append = (s: string) => {
    budget();
    const size = encoder.encode(s).length;
    if (chars >= p.max_chars! || bytes + size > OBSERVE_MAX_BYTES) {
      truncated = true;
      throw stop;
    }
    text += s;
    chars++;
    bytes += size;
  };
  const excluded = new Set([
    "INPUT",
    "TEXTAREA",
    "SELECT",
    "OPTION",
    "SCRIPT",
    "STYLE",
    "TEMPLATE",
    "IFRAME",
    "OBJECT",
    "EMBED",
    "CANVAS",
    "SVG",
    "NOSCRIPT",
  ]);
  try {
    const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        budget();
        nodes++;
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as HTMLElement;
          if (
            excluded.has(el.tagName) ||
            el.hasAttribute("contenteditable") ||
            el.hasAttribute("hidden") ||
            el.getAttribute("aria-hidden")?.toLowerCase() === "true" ||
            el.hasAttribute("inert") ||
            el.hasAttribute("data-bsk-overlay") ||
            el.hasAttribute("data-bsk-overlay-surface") ||
            el.tagName === "BROWSER-SKILL-OVERLAY" ||
            el.classList.contains("bsk-overlay-root") ||
            el.shadowRoot ||
            el.localName.includes("-")
          ) {
            return NodeFilter.FILTER_REJECT;
          }
          const style = win.getComputedStyle(el);
          if (
            style.display === "none" ||
            style.visibility !== "visible" ||
            Number(style.opacity) !== 1 ||
            style.contentVisibility === "hidden" ||
            (style.filter !== "none" && style.filter !== "") ||
            (style.clipPath !== "none" && style.clipPath !== "")
          ) {
            return NodeFilter.FILTER_REJECT;
          }
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let node: Node | null;
    while ((node = walker.nextNode())) {
      budget();
      if (node.nodeType !== Node.TEXT_NODE || !node.parentElement) continue;
      const parent = node.parentElement;
      const range = doc.createRange();
      const source = node as Text;
      let offset = 0;
      let emitted = false;
      // 按字符测量，不先取整个 innerText；视口外或被其他元素覆盖的字符不返回。
      while (offset < source.length) {
        budget();
        const first = source.substringData(offset, 2);
        const char = String.fromCodePoint(first.codePointAt(0)!);
        range.setStart(node, offset);
        offset += char.length;
        range.setEnd(node, offset);
        const rects = Array.from(range.getClientRects());
        const visible =
          rects.length > 0 &&
          rects.every((r) => {
            if (
              r.width <= 0 ||
              r.height <= 0 ||
              r.left < 0 ||
              r.top < 0 ||
              r.right > win.innerWidth ||
              r.bottom > win.innerHeight
            )
              return false;
            const dx = Math.min(0.5, r.width / 4);
            const dy = Math.min(0.5, r.height / 4);
            return [
              [r.left + dx, r.top + dy],
              [r.right - dx, r.top + dy],
              [r.left + dx, r.bottom - dy],
              [r.right - dx, r.bottom - dy],
              [(r.left + r.right) / 2, (r.top + r.bottom) / 2],
            ].every(([x, y]) => doc.elementFromPoint(x, y) === parent);
          });
        if (!visible) continue;
        if (/\s/u.test(char)) {
          if (text && !text.endsWith(" ") && !text.endsWith("\n")) append(" ");
        } else {
          append(char);
          emitted = true;
        }
      }
      if (emitted && !text.endsWith("\n")) append("\n");
    }
    budget();
  } catch (error) {
    if (error !== stop)
      return { code: "protocol_error", message: "visible text could not be verified" };
  }
  if (win.location.origin !== origin)
    return { code: "permission_denied", message: "document origin changed" };
  text = text.replace(/https?:\/\/[^\s<>]+/gi, "[url]").trim();
  return { origin, text, truncated, top: true };
}

export function registerUserTabObserve() {
  const listener = (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    respond: (value: unknown) => void,
  ) => {
    if (
      !message ||
      typeof message !== "object" ||
      (message as { type?: unknown }).type !== USER_TAB_OBSERVE
    )
      return;
    if (sender.id !== chrome.runtime.id || sender.tab) {
      respond({ code: "permission_denied", message: "only extension background may observe" });
      return;
    }
    respond(observeUserTab(message));
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
