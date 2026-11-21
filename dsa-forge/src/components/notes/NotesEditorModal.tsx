"use client";

import React, { useEffect, useRef, useCallback, useState } from "react";
import {
  X,
  Bold,
  Italic,
  Underline,
  Heading1,
  Heading2,
  List,
  ListOrdered,
  Code,
  Check,
  BookOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NotesEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  problemTitle: string;
  problemExternalId?: string | number;
  initialNotes: string;
  onSave: (notes: string) => void;
}

/**
 * Escapes characters that have HTML meaning inside code blocks.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Converts Markdown string to HTML for the WYSIWYG contentEditable editor.
 * Accurately parses ```lang fenced code blocks, headings, lists, and inline styles.
 */
function markdownToHtml(md: string): string {
  if (!md || !md.trim()) return "";
  const trimmedMd = md.trim();

  // If already legacy HTML format without markdown fences, return directly
  if (/^<(p|div|h1|h2|ul|ol|pre)\b/i.test(trimmedMd) && !trimmedMd.includes("```")) {
    return trimmedMd;
  }

  const formatInline = (str: string) => {
    // Preserve <u> tags while escaping bare HTML brackets
    const safe = str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/&lt;u&gt;(.*?)&lt;\/u&gt;/gi, "<u>$1</u>");

    return safe
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/__(.+?)__/g, "<u>$1</u>")
      .replace(/\*([^*]+?)\*/g, "<i>$1</i>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  };

  const lines = trimmedMd.split("\n");
  const result: string[] = [];
  let inUl = false;
  let inOl = false;
  let inCode = false;
  let codeLang = "";
  let codeLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Fenced Code Block start / end
    if (trimmed.startsWith("```")) {
      if (inCode) {
        // Close code block
        inCode = false;
        const codeContent = escapeHtml(codeLines.join("\n"));
        result.push(
          `<pre class="code-block" data-lang="${codeLang}"><code>${codeContent}</code></pre>`
        );
        codeLines = [];
        codeLang = "";
      } else {
        // Open code block
        if (inUl) { result.push("</ul>"); inUl = false; }
        if (inOl) { result.push("</ol>"); inOl = false; }
        inCode = true;
        codeLang = trimmed.slice(3).trim();
        codeLines = [];
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (trimmed.startsWith("### ")) {
      if (inUl) { result.push("</ul>"); inUl = false; }
      if (inOl) { result.push("</ol>"); inOl = false; }
      result.push(`<h2>${formatInline(trimmed.slice(4))}</h2>`);
    } else if (trimmed.startsWith("## ")) {
      if (inUl) { result.push("</ul>"); inUl = false; }
      if (inOl) { result.push("</ol>"); inOl = false; }
      result.push(`<h2>${formatInline(trimmed.slice(3))}</h2>`);
    } else if (trimmed.startsWith("# ")) {
      if (inUl) { result.push("</ul>"); inUl = false; }
      if (inOl) { result.push("</ol>"); inOl = false; }
      result.push(`<h1>${formatInline(trimmed.slice(2))}</h1>`);
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      if (inOl) { result.push("</ol>"); inOl = false; }
      if (!inUl) { result.push("<ul>"); inUl = true; }
      result.push(`<li>${formatInline(trimmed.slice(2))}</li>`);
    } else if (/^\d+\.\s/.test(trimmed)) {
      if (inUl) { result.push("</ul>"); inUl = false; }
      if (!inOl) { result.push("<ol>"); inOl = true; }
      const content = trimmed.replace(/^\d+\.\s/, "");
      result.push(`<li>${formatInline(content)}</li>`);
    } else if (trimmed === "") {
      if (inUl) { result.push("</ul>"); inUl = false; }
      if (inOl) { result.push("</ol>"); inOl = false; }
      result.push("<p><br></p>");
    } else {
      if (inUl) { result.push("</ul>"); inUl = false; }
      if (inOl) { result.push("</ol>"); inOl = false; }
      result.push(`<p>${formatInline(line)}</p>`);
    }
  }

  if (inCode) {
    const codeContent = escapeHtml(codeLines.join("\n"));
    result.push(
      `<pre class="code-block" data-lang="${codeLang}"><code>${codeContent}</code></pre>`
    );
  }
  if (inUl) result.push("</ul>");
  if (inOl) result.push("</ol>");

  return result.join("");
}

/**
 * Converts WYSIWYG HTML back to clean, compact Markdown string for storage.
 * Uses DOM traversal to:
 * 1. Accurately preserve <pre><code> as ```lang code fences
 * 2. Never strip C++/Java generics like <int> inside code
 * 3. Never inject double newlines (\n\n) between adjacent paragraphs or code lines
 * 4. Respect deleted lines and empty paragraphs accurately
 */
function htmlToMarkdown(html: string): string {
  if (!html || !html.trim()) return "";
  if (typeof document === "undefined") return html;

  const temp = document.createElement("div");
  temp.innerHTML = html;

  function serializeNode(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || "";
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    // Code block (<pre>)
    if (tag === "pre") {
      const code = el.textContent || "";
      const lang = el.getAttribute("data-lang") || "";
      const normalizedCode = code.replace(/\r\n/g, "\n").trimEnd();
      return `\n\`\`\`${lang}\n${normalizedCode}\n\`\`\`\n`;
    }

    // Inline code (not inside a pre)
    if (tag === "code") {
      return `\`${el.textContent || ""}\``;
    }

    // Bold
    if (tag === "b" || tag === "strong") {
      const inner = Array.from(el.childNodes).map(serializeNode).join("");
      return inner.trim() ? `**${inner}**` : "";
    }

    // Italic
    if (tag === "i" || tag === "em") {
      const inner = Array.from(el.childNodes).map(serializeNode).join("");
      return inner.trim() ? `*${inner}*` : "";
    }

    // Underline
    if (tag === "u") {
      const inner = Array.from(el.childNodes).map(serializeNode).join("");
      return inner.trim() ? `<u>${inner}</u>` : "";
    }

    // Headings
    if (tag === "h1") {
      const inner = Array.from(el.childNodes).map(serializeNode).join("").trim();
      return inner ? `\n# ${inner}\n` : "";
    }
    if (tag === "h2") {
      const inner = Array.from(el.childNodes).map(serializeNode).join("").trim();
      return inner ? `\n## ${inner}\n` : "";
    }
    if (tag === "h3") {
      const inner = Array.from(el.childNodes).map(serializeNode).join("").trim();
      return inner ? `\n### ${inner}\n` : "";
    }

    // Lists
    if (tag === "ul") {
      const items = Array.from(el.querySelectorAll(":scope > li"))
        .map((li) => `- ${Array.from(li.childNodes).map(serializeNode).join("").trim()}`)
        .join("\n");
      return items ? `\n${items}\n` : "";
    }
    if (tag === "ol") {
      const items = Array.from(el.querySelectorAll(":scope > li"))
        .map((li, idx) => `${idx + 1}. ${Array.from(li.childNodes).map(serializeNode).join("").trim()}`)
        .join("\n");
      return items ? `\n${items}\n` : "";
    }
    if (tag === "li") {
      return Array.from(el.childNodes).map(serializeNode).join("");
    }

    // Line breaks
    if (tag === "br") {
      return "\n";
    }

    // Paragraphs and Divs
    if (tag === "p" || tag === "div") {
      const text = el.textContent || "";
      const isBlank =
        (!text.trim() && el.querySelectorAll("br").length > 0) ||
        (!text.trim() && el.children.length === 0);
      if (isBlank) {
        return "\n\n";
      }
      const inner = Array.from(el.childNodes).map(serializeNode).join("");
      return `\n${inner}`;
    }

    // Fallback: child nodes (span, etc.)
    return Array.from(el.childNodes).map(serializeNode).join("");
  }

  const raw = Array.from(temp.childNodes).map(serializeNode).join("");
  return raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function NotesEditorModal({
  isOpen,
  onClose,
  problemTitle,
  problemExternalId,
  initialNotes,
  onSave,
}: NotesEditorModalProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const wordCountRef = useRef<HTMLSpanElement>(null);
  const saveStatusRef = useRef<HTMLSpanElement>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const wasOpenRef = useRef(false);
  const lastSavedMdRef = useRef(initialNotes);

  const [activeFormats, setActiveFormats] = useState({
    bold: false,
    italic: false,
    underline: false,
    h1: false,
    h2: false,
    ul: false,
    ol: false,
    code: false,
  });

  const checkActiveFormats = useCallback(() => {
    if (typeof document === "undefined" || !editorRef.current) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!editorRef.current.contains(range.commonAncestorContainer)) return;

    let bold = false;
    let italic = false;
    let underline = false;
    let ul = false;
    let ol = false;
    let h1 = false;
    let h2 = false;
    let code = false;

    try {
      bold = document.queryCommandState("bold");
      italic = document.queryCommandState("italic");
      underline = document.queryCommandState("underline");
      ul = document.queryCommandState("insertUnorderedList");
      ol = document.queryCommandState("insertOrderedList");

      const block = (document.queryCommandValue("formatBlock") || "").toLowerCase();
      if (block === "h1") h1 = true;
      if (block === "h2") h2 = true;
      if (block === "pre") code = true;
    } catch {}

    let node: Node | null = range.commonAncestorContainer;
    while (node && node !== editorRef.current) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        const tag = el.tagName.toLowerCase();
        if (tag === "pre" || tag === "code") code = true;
        if (tag === "h1") h1 = true;
        if (tag === "h2") h2 = true;
        if (tag === "b" || tag === "strong") bold = true;
        if (tag === "i" || tag === "em") italic = true;
        if (tag === "u") underline = true;
        if (tag === "ul") ul = true;
        if (tag === "ol") ol = true;
      }
      node = node.parentNode;
    }

    setActiveFormats({ bold, italic, underline, h1, h2, ul, ol, code });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onSelectionChange = () => checkActiveFormats();
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [isOpen, checkActiveFormats]);

  // Initialize editor content ONLY once when modal transitions from closed to open
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      wasOpenRef.current = true;
      lastSavedMdRef.current = initialNotes;
      if (editorRef.current) {
        const html = markdownToHtml(initialNotes || "");
        editorRef.current.innerHTML = html;

        // Initialize word count directly on DOM
        if (wordCountRef.current) {
          const text = editorRef.current.innerText || "";
          const trimmed = text.trim();
          const count = trimmed ? trimmed.split(/\s+/).length : 0;
          wordCountRef.current.textContent = `${count} words`;
        }
        if (saveStatusRef.current) {
          saveStatusRef.current.textContent = "Saved";
          saveStatusRef.current.className = "text-[11px] font-medium text-emerald-400/90 hidden sm:inline";
        }

        // Focus editor
        setTimeout(() => {
          if (editorRef.current) {
            editorRef.current.focus();
            checkActiveFormats();
          }
        }, 50);
      }
    } else if (!isOpen) {
      wasOpenRef.current = false;
    }
  }, [isOpen, initialNotes, checkActiveFormats]);

  // Handle saving and closing safely
  const handleSaveAndClose = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    try {
      if (editorRef.current) {
        const md = htmlToMarkdown(editorRef.current.innerHTML);
        if (md !== lastSavedMdRef.current) {
          lastSavedMdRef.current = md;
          onSave(md);
        }
      }
    } catch (err) {
      console.error("[NotesEditorModal] Error saving notes:", err);
    } finally {
      onClose();
    }
  }, [onSave, onClose]);

  // Handle typing & content change without triggering ANY React re-renders (zero thread blocking)
  const handleInput = () => {
    // 1. Direct DOM update for word count (0ms, 0 React renders)
    if (wordCountRef.current && editorRef.current) {
      const text = editorRef.current.innerText || "";
      const trimmed = text.trim();
      const count = trimmed ? trimmed.split(/\s+/).length : 0;
      wordCountRef.current.textContent = `${count} words`;
    }

    // 2. Direct DOM update for status indicator (0ms, 0 React renders)
    if (saveStatusRef.current) {
      saveStatusRef.current.textContent = "Saving...";
      saveStatusRef.current.className = "text-[11px] font-medium text-amber-400/90 hidden sm:inline";
    }

    checkActiveFormats();

    // 3. Debounced quiet background sync
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      try {
        if (editorRef.current) {
          const md = htmlToMarkdown(editorRef.current.innerHTML);
          if (md !== lastSavedMdRef.current) {
            lastSavedMdRef.current = md;
            onSave(md);
          }
        }
      } catch (err) {
        console.error("[NotesEditorModal] Auto-save error:", err);
      } finally {
        if (saveStatusRef.current) {
          saveStatusRef.current.textContent = "Saved";
          saveStatusRef.current.className = "text-[11px] font-medium text-emerald-400/90 hidden sm:inline";
        }
      }
    }, 2000);
  };

  // Keyboard shortcuts (Escape, Ctrl+Enter)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleSaveAndClose();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        handleSaveAndClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleSaveAndClose]);

  if (!isOpen) return null;

  // Execute formatting command on text selection
  const execCmd = (command: string, value: string | undefined = undefined) => {
    if (typeof document !== "undefined") {
      document.execCommand(command, false, value);
      handleInput();
      checkActiveFormats();
      if (editorRef.current) {
        editorRef.current.focus();
      }
    }
  };

  // Toggle heading level or revert to normal paragraph if already active
  const toggleHeading = (tag: "H1" | "H2") => {
    if (typeof document === "undefined") return;
    try {
      const currentBlock = (document.queryCommandValue("formatBlock") || "").toUpperCase();
      if (currentBlock === tag) {
        document.execCommand("formatBlock", false, "<p>");
      } else {
        document.execCommand("formatBlock", false, `<${tag.toLowerCase()}>`);
      }
    } catch {
      document.execCommand("formatBlock", false, `<${tag.toLowerCase()}>`);
    }
    handleInput();
    checkActiveFormats();
    if (editorRef.current) {
      editorRef.current.focus();
    }
  };

  // Toggle code block formatting
  const toggleCodeBlock = () => {
    if (typeof document === "undefined" || !editorRef.current) return;
    try {
      const sel = window.getSelection();
      let preNode: HTMLElement | null = null;
      if (sel && sel.rangeCount > 0) {
        let node: Node | null = sel.getRangeAt(0).commonAncestorContainer;
        while (node && node !== editorRef.current) {
          if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName.toLowerCase() === "pre") {
            preNode = node as HTMLElement;
            break;
          }
          node = node.parentNode;
        }
      }

      if (preNode) {
        document.execCommand("formatBlock", false, "<p>");
      } else {
        document.execCommand("formatBlock", false, "<pre>");
      }
    } catch {
      document.execCommand("formatBlock", false, "<pre>");
    }
    handleInput();
    checkActiveFormats();
    if (editorRef.current) {
      editorRef.current.focus();
    }
  };

  // Intelligent paste handler for code blocks and formatted text
  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;

    // Detect if pasted content is code (multiple lines with indentation, braces, semicolons or code keywords)
    const isCode =
      text.includes("\n") &&
      (/[{}();=>]|^\s{2,}|\b(def|class|function|var|let|const|int|public|private|void|return|if|for|while|import|include)\b/m.test(text) ||
        text.trim().startsWith("//") ||
        text.trim().startsWith("#"));

    // Check if cursor is already inside a pre element
    const sel = window.getSelection();
    let inPre = false;
    if (sel && sel.rangeCount > 0) {
      let node: Node | null = sel.getRangeAt(0).commonAncestorContainer;
      while (node && node !== editorRef.current) {
        if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName.toLowerCase() === "pre") {
          inPre = true;
          break;
        }
        node = node.parentNode;
      }
    }

    if (inPre) {
      e.preventDefault();
      document.execCommand("insertText", false, text);
      handleInput();
      checkActiveFormats();
      return;
    }

    if (isCode) {
      e.preventDefault();
      const escaped = escapeHtml(text);
      const preHtml = `<pre class="code-block"><code>${escaped}</code></pre><p><br></p>`;
      document.execCommand("insertHTML", false, preHtml);
      handleInput();
      checkActiveFormats();
      return;
    }
  };

  const getBtnClass = (isActive: boolean) =>
    cn(
      "p-1.5 rounded-lg transition-all cursor-pointer text-xs flex items-center justify-center gap-1",
      isActive
        ? "bg-violet-600/35 text-violet-200 border border-violet-500/50 shadow-[0_0_12px_rgba(139,92,246,0.3)]"
        : "text-zinc-400 hover:text-white hover:bg-white/10 border border-transparent"
    );

  return (
    <div
      className="fixed inset-0 z-[250] flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150"
      onClick={handleSaveAndClose}
    >
      {/* Dimmed backdrop */}
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" />

      {/* Fixed Comfortable Dialog */}
      <div
        className={cn(
          "relative z-10 w-full max-w-2xl h-[520px] max-h-[85vh] bg-[#0d0f1e] border border-white/10 rounded-2xl flex flex-col shadow-2xl shadow-black/80 overflow-hidden"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-white/[0.08] bg-white/[0.02]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-violet-600/20 border border-violet-500/30 flex items-center justify-center text-violet-400 shrink-0">
              <BookOpen className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-white truncate">Notes</h2>
              <p className="text-[11px] text-zinc-400 truncate max-w-[220px] sm:max-w-md">
                {problemExternalId ? `#${problemExternalId} ` : ""}
                {problemTitle}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span
              ref={saveStatusRef}
              className="text-[11px] font-medium text-emerald-400/90 hidden sm:inline"
            >
              Saved
            </span>
            <button
              onClick={handleSaveAndClose}
              type="button"
              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Visual WYSIWYG Formatting Toolbar with Active Glow ── */}
        <div className="px-3 sm:px-4 py-2 border-b border-white/[0.06] bg-white/[0.015] flex items-center gap-1 overflow-x-auto no-scrollbar">
          {/* Headings */}
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              toggleHeading("H1");
            }}
            className={getBtnClass(activeFormats.h1)}
            title="Large Heading"
          >
            <Heading1 className="w-4 h-4" />
          </button>

          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              toggleHeading("H2");
            }}
            className={getBtnClass(activeFormats.h2)}
            title="Medium Heading"
          >
            <Heading2 className="w-4 h-4" />
          </button>

          <div className="h-4 w-px bg-white/10 mx-1" />

          {/* Bold, Italic, Underline */}
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              execCmd("bold");
            }}
            className={getBtnClass(activeFormats.bold)}
            title="Bold (Ctrl+B)"
          >
            <Bold className="w-4 h-4 font-bold" />
          </button>

          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              execCmd("italic");
            }}
            className={getBtnClass(activeFormats.italic)}
            title="Italic (Ctrl+I)"
          >
            <Italic className="w-4 h-4 italic" />
          </button>

          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              execCmd("underline");
            }}
            className={getBtnClass(activeFormats.underline)}
            title="Underline (Ctrl+U)"
          >
            <Underline className="w-4 h-4 underline" />
          </button>

          {/* Code Block Button */}
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              toggleCodeBlock();
            }}
            className={getBtnClass(activeFormats.code)}
            title="Code Block"
          >
            <Code className="w-4 h-4" />
          </button>

          <div className="h-4 w-px bg-white/10 mx-1" />

          {/* Lists */}
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              execCmd("insertUnorderedList");
            }}
            className={getBtnClass(activeFormats.ul)}
            title="Bullet List"
          >
            <List className="w-4 h-4" />
          </button>

          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              execCmd("insertOrderedList");
            }}
            className={getBtnClass(activeFormats.ol)}
            title="Numbered List"
          >
            <ListOrdered className="w-4 h-4" />
          </button>
        </div>

        {/* ── Visual WYSIWYG Writing Area ── */}
        <div className="flex-1 p-4 sm:p-5 flex flex-col overflow-hidden">
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            onInput={handleInput}
            onPaste={handlePaste}
            onKeyUp={checkActiveFormats}
            onMouseUp={checkActiveFormats}
            data-placeholder="Add your approach, time complexity, code or insight..."
            className={cn(
              "w-full flex-1 bg-transparent text-sm sm:text-base text-zinc-100 focus:outline-none overflow-y-auto leading-relaxed select-text scrollbar-thin",
              // Instant Visual Formatting Styles
              "[&_h1]:text-lg [&_h1]:sm:text-xl [&_h1]:font-bold [&_h1]:text-white [&_h1]:mb-2 [&_h1]:mt-2",
              "[&_h2]:text-base [&_h2]:sm:text-lg [&_h2]:font-semibold [&_h2]:text-white [&_h2]:mb-1.5 [&_h2]:mt-2",
              "[&_b]:font-bold [&_b]:text-white [&_strong]:font-bold [&_strong]:text-white",
              "[&_i]:italic [&_i]:text-violet-200 [&_em]:italic [&_em]:text-violet-200",
              "[&_u]:underline [&_u]:underline-offset-2 [&_u]:decoration-violet-400",
              "[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-1.5 [&_ul]:space-y-1",
              "[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-1.5 [&_ol]:space-y-1",
              "[&_p]:my-1",
              "[&_code]:bg-violet-500/15 [&_code]:border [&_code]:border-violet-500/30 [&_code]:text-cyan-300 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono",
              // Code Block Syntax Styling
              "[&_pre]:my-2.5 [&_pre]:p-3.5 [&_pre]:rounded-xl [&_pre]:bg-[#080914] [&_pre]:border [&_pre]:border-white/10 [&_pre]:font-mono [&_pre]:text-xs [&_pre]:text-cyan-300 [&_pre]:leading-relaxed [&_pre]:overflow-x-auto [&_pre]:shadow-inner [&_pre]:whitespace-pre",
              "[&_pre_code]:bg-transparent [&_pre_code]:border-0 [&_pre_code]:p-0 [&_pre_code]:text-inherit [&_pre_code]:font-mono",
              // Clean placeholder when empty
              "empty:before:content-[attr(data-placeholder)] empty:before:text-zinc-600 empty:before:pointer-events-none"
            )}
            spellCheck={false}
          />
        </div>

        {/* ── Footer ── */}
        <div className="px-4 sm:px-5 py-2.5 border-t border-white/[0.08] bg-black/30 flex items-center justify-between text-xs text-zinc-500">
          <span ref={wordCountRef}>0 words</span>

          <button
            type="button"
            onClick={handleSaveAndClose}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold transition-all cursor-pointer active:scale-95"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Done</span>
          </button>
        </div>
      </div>
    </div>
  );
}
