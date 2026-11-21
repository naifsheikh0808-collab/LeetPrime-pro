"use client";

import React, { useEffect, useRef, useCallback, useState } from "react";
import {
  X,
  Bold,
  Italic,
  Underline,
  Highlighter,
  Heading1,
  Heading2,
  List,
  ListOrdered,
  Code,
  Check,
  BookOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { tokenizeCode, getTokenClass } from "@/components/ai/PrimeAiMessageRenderer";

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
 * Produces syntax-highlighted HTML spans for the code block in the notes editor.
 */
function highlightCodeHtml(code: string, lang = "cpp"): string {
  if (!code) return "<br>";
  const tokens = tokenizeCode(code, lang || "cpp");
  return tokens
    .map((t) => {
      const cls = getTokenClass(t.type, t.value);
      const val = escapeHtml(t.value);
      if (t.type === "plain") {
        return val;
      }
      return `<span class="${cls}">${val}</span>`;
    })
    .join("");
}

/**
 * Extracts raw multiline text from a code DOM element without losing newlines.
 */
function extractCodeText(codeEl: HTMLElement): string {
  let text = "";
  for (const node of Array.from(codeEl.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent || "";
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();
      if (tag === "br") {
        text += "\n";
      } else if (tag === "div" || tag === "p") {
        text += "\n" + (el.innerText || el.textContent || "");
      } else {
        text += el.innerText || el.textContent || "";
      }
    }
  }
  if (!text) {
    text = codeEl.innerText || codeEl.textContent || "";
  }
  return text.replace(/\r\n/g, "\n");
}

/**
 * Generates interactive collapsible code block HTML for the WYSIWYG editor.
 * Includes colorful syntax highlighting, interchangeable "Exit to notes / Expand", and delete button.
 */
function createCodeBlockHtml(code: string, lang = "code", isCollapsed = true): string {
  const lines = code.split("\n");
  const lineCount = code.trim() ? lines.length : 1;
  const highlightedCode = highlightCodeHtml(code, lang);

  const chevronText = isCollapsed ? "▶" : "▼";
  const hiddenCls = isCollapsed ? " hidden" : "";
  const toggleBtnText = isCollapsed ? "Expand ↗" : "Exit to notes ↓";
  const toggleAction = isCollapsed ? "expand-code" : "exit-code";

  return (
    `<div class="code-block-container my-3 rounded-xl border border-white/10 bg-[#080914] overflow-hidden select-none" contenteditable="false" data-lang="code">` +
      `<div class="code-block-header flex items-center justify-between px-3 py-1.5 bg-white/[0.04] border-b border-white/[0.08] text-xs text-zinc-400 cursor-pointer hover:bg-white/[0.07] transition-colors" data-action="toggle-collapse">` +
        `<div class="flex items-center gap-2">` +
          `<span class="code-chevron text-[11px] text-violet-400 font-bold">${chevronText}</span>` +
          `<span class="code-lang-badge px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 text-[10px] font-mono font-bold">Code</span>` +
          `<span class="code-line-count text-[11px] text-zinc-400 font-mono">${lineCount} ${lineCount === 1 ? "line" : "lines"}${isCollapsed ? " (collapsed)" : ""}</span>` +
        `</div>` +
        `<div class="flex items-center gap-2.5">` +
          `<button type="button" class="code-toggle-btn text-[10px] font-medium text-violet-400 hover:text-violet-300 transition-colors cursor-pointer" data-action="${toggleAction}">${toggleBtnText}</button>` +
          `<button type="button" class="code-delete-btn p-1 rounded hover:bg-red-500/20 text-zinc-400 hover:text-red-400 transition-colors cursor-pointer flex items-center justify-center" data-action="delete-code" title="Delete code block"><svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>` +
        `</div>` +
      `</div>` +
      `<pre class="code-content p-3 text-xs font-mono text-slate-100 leading-relaxed overflow-x-auto whitespace-pre outline-none select-text${hiddenCls}" contenteditable="true" spellcheck="false">${highlightedCode}</pre>` +
    `</div><p><br></p>`
  );
}

/**
 * Converts Markdown string to HTML for the WYSIWYG contentEditable editor.
 * Accurately parses ```lang fenced code blocks into collapsible interactive blocks.
 */
function markdownToHtml(md: string): string {
  if (!md || !md.trim()) return "<p><br></p>";
  const trimmedMd = md.trim();

  // If already legacy HTML format without markdown fences, return directly
  if (/^<(p|div|h1|h2|ul|ol|pre)\b/i.test(trimmedMd) && !trimmedMd.includes("```")) {
    return trimmedMd;
  }

  const formatInline = (str: string) => {
    // Preserve <u> and <mark> tags while escaping bare HTML brackets
    const safe = str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/&lt;u&gt;(.*?)&lt;\/u&gt;/gi, "<u>$1</u>")
      .replace(
        /&lt;mark&gt;(.*?)&lt;\/mark&gt;/gi,
        '<code class="prime-highlight px-1.5 py-0.5 rounded bg-cyan-500/15 border border-cyan-500/35 text-cyan-200 font-mono text-[12px] font-semibold tracking-tight inline-block align-baseline">$1</code>'
      );

    return safe
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/__(.+?)__/g, "<u>$1</u>")
      .replace(/\*([^*]+?)\*/g, "<i>$1</i>")
      .replace(
        /`([^`]+)`/g,
        '<code class="prime-highlight px-1.5 py-0.5 rounded bg-cyan-500/15 border border-cyan-500/35 text-cyan-200 font-mono text-[12px] font-semibold tracking-tight inline-block align-baseline">$1</code>'
      );
  };

  const lines = trimmedMd.split(/\r?\n/);
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
        // Close code block (ALWAYS collapsed by default when opening notes)
        inCode = false;
        result.push(createCodeBlockHtml(codeLines.join("\n"), codeLang, true));
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
    result.push(createCodeBlockHtml(codeLines.join("\n"), codeLang, true));
  }
  if (inUl) result.push("</ul>");
  if (inOl) result.push("</ol>");

  // Ensure editor ends with a normal paragraph for easy typing
  const finalHtml = result.join("");
  if (!finalHtml.endsWith("<p><br></p>") && !finalHtml.endsWith("</p>")) {
    return finalHtml + "<p><br></p>";
  }
  return finalHtml;
}

/**
 * Converts WYSIWYG HTML back to clean, compact Markdown string for storage.
 * Accurately extracts code from collapsible code containers without line loss.
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

    // 1. Interactive collapsible code container
    if (el.classList.contains("code-block-container")) {
      const pre = el.querySelector(".code-content") as HTMLElement;
      const lang = el.getAttribute("data-lang") || "";
      const code = pre ? extractCodeText(pre) : "";
      return `\n\`\`\`${lang}\n${code.trimEnd()}\n\`\`\`\n`;
    }

    // 2. Bare code block (<pre>)
    if (tag === "pre") {
      const code = extractCodeText(el);
      const lang = el.getAttribute("data-lang") || "";
      return `\n\`\`\`${lang}\n${code.trimEnd()}\n\`\`\`\n`;
    }

    // Inline code or Prime AI highlight (not inside a pre)
    if (tag === "code" || tag === "mark") {
      const inner = (el.textContent || "").replace(/\u200B/g, "").trim();
      return inner ? `\`${inner.replace(/`/g, "")}\`` : "";
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
    highlight: false,
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
    let highlight = false;
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
        if (
          el.classList.contains("prime-highlight") ||
          tag === "mark" ||
          (tag === "code" && !el.closest(".code-block-container") && !el.closest("pre"))
        ) {
          highlight = true;
        }
        if (el.classList.contains("code-block-container") || el.classList.contains("code-content") || tag === "pre") {
          code = true;
        }
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

    setActiveFormats({ bold, italic, underline, highlight, h1, h2, ul, ol, code });
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

  // Keyboard shortcuts (Escape, Ctrl+Enter, Ctrl+H for highlight)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleSaveAndClose();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        handleSaveAndClose();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "h" || e.key === "H")) {
        e.preventDefault();
        toggleHighlight();
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

  // Helper to expand a collapsed code block
  const expandCodeBlock = (container: HTMLElement) => {
    const pre = container.querySelector(".code-content") as HTMLElement;
    const chevron = container.querySelector(".code-chevron") as HTMLElement;
    const lineCount = container.querySelector(".code-line-count") as HTMLElement;
    const toggleBtn = container.querySelector(".code-toggle-btn") as HTMLElement;
    if (!pre) return;

    pre.classList.remove("hidden");
    if (chevron) chevron.textContent = "▼";
    if (toggleBtn) {
      toggleBtn.textContent = "Exit to notes ↓";
      toggleBtn.setAttribute("data-action", "exit-code");
    }
    const text = extractCodeText(pre);
    const count = text.split("\n").filter((l) => l.length > 0).length || 1;
    if (lineCount) lineCount.textContent = `${count} ${count === 1 ? "line" : "lines"}`;
    pre.focus();
    checkActiveFormats();
  };

  // Helper to exit a code block into the paragraph below and collapse it
  const exitCodeBlock = (container: HTMLElement) => {
    const pre = container.querySelector(".code-content") as HTMLElement;
    const chevron = container.querySelector(".code-chevron") as HTMLElement;
    const lineCount = container.querySelector(".code-line-count") as HTMLElement;
    const toggleBtn = container.querySelector(".code-toggle-btn") as HTMLElement;
    if (pre) {
      pre.classList.add("hidden");
      if (chevron) chevron.textContent = "▶";
      if (toggleBtn) {
        toggleBtn.textContent = "Expand ↗";
        toggleBtn.setAttribute("data-action", "expand-code");
      }
      const text = extractCodeText(pre);
      const count = text.split("\n").filter((l) => l.length > 0).length || 1;
      if (lineCount) lineCount.textContent = `${count} ${count === 1 ? "line" : "lines"} (collapsed)`;
    }

    // Find or create normal paragraph below
    let nextEl = container.nextElementSibling as HTMLElement;
    if (!nextEl || nextEl.tagName.toLowerCase() !== "p") {
      const p = document.createElement("p");
      p.innerHTML = "<br>";
      container.parentNode?.insertBefore(p, container.nextSibling);
      nextEl = p;
    }

    // Move selection and focus to that paragraph
    const range = document.createRange();
    const sel = window.getSelection();
    range.setStart(nextEl, 0);
    range.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(range);
    nextEl.focus();

    handleInput();
    checkActiveFormats();
  };

  // Helper to toggle container collapse/expand
  const toggleContainerCollapse = (container: HTMLElement) => {
    const pre = container.querySelector(".code-content") as HTMLElement;
    if (!pre) return;

    if (pre.classList.contains("hidden")) {
      expandCodeBlock(container);
    } else {
      exitCodeBlock(container);
    }
  };

  // Toggle inline Prime AI highlight on selection or enable typing inside highlight
  const toggleHighlight = () => {
    if (typeof document === "undefined" || !editorRef.current) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);

    if (!editorRef.current.contains(range.commonAncestorContainer)) return;

    // Check if cursor or selection is already inside an inline highlight element
    let existingHighlight: HTMLElement | null = null;
    let curr: Node | null = range.commonAncestorContainer;
    while (curr && curr !== editorRef.current) {
      if (curr.nodeType === Node.ELEMENT_NODE) {
        const el = curr as HTMLElement;
        const tag = el.tagName.toLowerCase();
        if (
          el.classList.contains("prime-highlight") ||
          tag === "mark" ||
          (tag === "code" && !el.closest(".code-block-container") && !el.closest("pre"))
        ) {
          existingHighlight = el;
          break;
        }
      }
      curr = curr.parentNode;
    }

    // CASE 1: Cursor or selection is ALREADY inside a highlight -> UNAPPLY or EXIT
    if (existingHighlight) {
      if (range.collapsed) {
        // Collapsed cursor inside highlight:
        const cleanText = (existingHighlight.textContent || "").replace(/\u200B/g, "");
        if (!cleanText.trim()) {
          // If empty (only zero-width space), delete the placeholder
          existingHighlight.remove();
          handleInput();
          checkActiveFormats();
          return;
        }

        // Jump cursor out directly after the highlight element to resume typing normal text
        const newRange = document.createRange();
        newRange.setStartAfter(existingHighlight);
        newRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(newRange);
        checkActiveFormats();
        return;
      } else {
        // Text is selected inside existing highlight -> unwrap to remove highlight
        const parent = existingHighlight.parentNode;
        if (parent) {
          while (existingHighlight.firstChild) {
            parent.insertBefore(existingHighlight.firstChild, existingHighlight);
          }
          existingHighlight.remove();
          handleInput();
          checkActiveFormats();
          return;
        }
      }
    }

    // CASE 2: NOT inside a highlight -> APPLY
    const highlightClasses =
      "prime-highlight px-1.5 py-0.5 rounded bg-cyan-500/15 border border-cyan-500/35 text-cyan-200 font-mono text-[12px] font-semibold tracking-tight inline-block align-baseline";

    if (range.collapsed) {
      // No text selected: insert an empty prime-highlight badge with \u200B and position cursor inside
      const highlightEl = document.createElement("code");
      highlightEl.className = highlightClasses;
      const textNode = document.createTextNode("\u200B");
      highlightEl.appendChild(textNode);
      range.insertNode(highlightEl);

      const newRange = document.createRange();
      newRange.setStart(textNode, 1);
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);
      handleInput();
      checkActiveFormats();
      return;
    } else {
      // Text is selected -> wrap selection in prime-highlight badge
      const selectedContent = range.extractContents();
      const highlightEl = document.createElement("code");
      highlightEl.className = highlightClasses;
      highlightEl.appendChild(selectedContent);
      range.insertNode(highlightEl);

      // Keep newly highlighted text selected
      const newRange = document.createRange();
      newRange.selectNodeContents(highlightEl);
      sel.removeAllRanges();
      sel.addRange(newRange);
      handleInput();
      checkActiveFormats();
      return;
    }
  };

  // Toggle or exit code block formatting
  const toggleCodeBlock = () => {
    if (typeof document === "undefined" || !editorRef.current) return;

    // Check if cursor is already inside a code block
    const sel = window.getSelection();
    let codeContainer: HTMLElement | null = null;
    let codeContent: HTMLElement | null = null;

    if (sel && sel.rangeCount > 0) {
      let node: Node | null = sel.getRangeAt(0).commonAncestorContainer;
      while (node && node !== editorRef.current) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as HTMLElement;
          if (el.classList.contains("code-block-container")) {
            codeContainer = el;
            break;
          }
          if (el.classList.contains("code-content") || el.tagName.toLowerCase() === "pre") {
            codeContent = el;
            codeContainer = el.closest(".code-block-container") as HTMLElement;
            break;
          }
        }
        node = node.parentNode;
      }
    }

    // CASE 1: Cursor is inside a code block -> User clicked <> to EXIT!
    if (codeContainer || codeContent) {
      const targetContainer = codeContainer || (codeContent?.parentElement as HTMLElement);
      if (targetContainer) {
        exitCodeBlock(targetContainer);
        return;
      }
    }

    // CASE 2: User is in normal notes -> Insert a new code block!
    const blockHtml = createCodeBlockHtml("", "code", false);
    document.execCommand("insertHTML", false, blockHtml);
    handleInput();
    checkActiveFormats();

    // Focus inside newly inserted code-content
    setTimeout(() => {
      if (editorRef.current) {
        const preElements = editorRef.current.querySelectorAll(".code-content");
        const lastPre = preElements[preElements.length - 1] as HTMLElement;
        if (lastPre) {
          lastPre.focus();
        }
      }
    }, 30);
  };

  // Click handler on editor to handle collapse/expand, exit clicks, and delete code button
  const handleEditorClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;

    // 1. Clicked on delete code block button (Requirement 4)
    const deleteBtn = target.closest('[data-action="delete-code"]');
    if (deleteBtn) {
      e.preventDefault();
      e.stopPropagation();
      const container = deleteBtn.closest(".code-block-container") as HTMLElement;
      if (container) {
        let nextEl = container.nextElementSibling as HTMLElement;
        if (!nextEl || nextEl.tagName.toLowerCase() !== "p") {
          const p = document.createElement("p");
          p.innerHTML = "<br>";
          container.parentNode?.insertBefore(p, container.nextSibling);
          nextEl = p;
        }
        container.remove();
        nextEl.focus();
        handleInput();
        checkActiveFormats();
      }
      return;
    }

    // 2. Clicked on expand button (Requirement 3)
    const expandBtn = target.closest('[data-action="expand-code"]');
    if (expandBtn) {
      e.preventDefault();
      e.stopPropagation();
      const container = expandBtn.closest(".code-block-container") as HTMLElement;
      if (container) {
        expandCodeBlock(container);
      }
      return;
    }

    // 3. Clicked on exit code button (Requirement 3)
    const exitBtn = target.closest('[data-action="exit-code"]');
    if (exitBtn) {
      e.preventDefault();
      e.stopPropagation();
      const container = exitBtn.closest(".code-block-container") as HTMLElement;
      if (container) {
        exitCodeBlock(container);
      }
      return;
    }

    // 4. Clicked on header to collapse/expand
    const header = target.closest('[data-action="toggle-collapse"]');
    if (header) {
      e.preventDefault();
      e.stopPropagation();
      const container = header.closest(".code-block-container") as HTMLElement;
      if (container) {
        toggleContainerCollapse(container);
      }
      return;
    }

    // 5. Clicked directly in empty bottom space below all elements
    if (target === editorRef.current && editorRef.current) {
      const lastChild = editorRef.current.lastElementChild;
      if (lastChild && lastChild.tagName.toLowerCase() === "p") {
        (lastChild as HTMLElement).focus();
      } else {
        const p = document.createElement("p");
        p.innerHTML = "<br>";
        editorRef.current.appendChild(p);
        p.focus();
      }
    }

    checkActiveFormats();
  };

  // Keyboard navigation inside editor: Tab for 4 spaces, Shift+Enter/Escape to exit code block
  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const sel = window.getSelection();
    let insideCode = false;
    let codeContentEl: HTMLElement | null = null;

    if (sel && sel.rangeCount > 0) {
      let node: Node | null = sel.getRangeAt(0).commonAncestorContainer;
      while (node && node !== editorRef.current) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as HTMLElement;
          if (el.classList.contains("code-content") || el.tagName.toLowerCase() === "pre") {
            insideCode = true;
            codeContentEl = el;
            break;
          }
        }
        node = node.parentNode;
      }
    }

    if (insideCode && codeContentEl) {
      // Tab key inside code -> indent 4 spaces
      if (e.key === "Tab") {
        e.preventDefault();
        document.execCommand("insertText", false, "    ");
        handleInput();
        return;
      }

      // Shift+Enter or Escape inside code -> Exit to notes below!
      if (e.key === "Escape" || (e.key === "Enter" && e.shiftKey)) {
        e.preventDefault();
        const container = codeContentEl.closest(".code-block-container") as HTMLElement;
        if (container) {
          exitCodeBlock(container);
        }
        return;
      }

      // Enter inside code block -> ensure clean newline and update line count
      if (e.key === "Enter") {
        setTimeout(() => {
          if (codeContentEl) {
            const container = codeContentEl.closest(".code-block-container");
            const lineCountEl = container?.querySelector(".code-line-count");
            if (lineCountEl) {
              const count = extractCodeText(codeContentEl).split("\n").length;
              lineCountEl.textContent = `${count} ${count === 1 ? "line" : "lines"}`;
            }
          }
        }, 10);
      }
    }
  };

  // Intelligent paste handler for code blocks and formatted text
  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;

    const sel = window.getSelection();
    let insideCode = false;
    let codeContentEl: HTMLElement | null = null;

    if (sel && sel.rangeCount > 0) {
      let node: Node | null = sel.getRangeAt(0).commonAncestorContainer;
      while (node && node !== editorRef.current) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as HTMLElement;
          if (el.classList.contains("code-content") || el.tagName.toLowerCase() === "pre") {
            insideCode = true;
            codeContentEl = el;
            break;
          }
        }
        node = node.parentNode;
      }
    }

    if (insideCode && codeContentEl) {
      e.preventDefault();
      document.execCommand("insertText", false, text);

      // Update line count in header
      const container = codeContentEl.closest(".code-block-container");
      const lineCountEl = container?.querySelector(".code-line-count");
      if (lineCountEl) {
        const count = extractCodeText(codeContentEl).split("\n").length;
        lineCountEl.textContent = `${count} ${count === 1 ? "line" : "lines"}`;
      }

      handleInput();
      checkActiveFormats();
      return;
    }

    // Outside code block: detect if pasted content is code
    const isCode =
      text.includes("\n") &&
      (/[{}();=>]|^\s{2,}|\b(def|class|function|var|let|const|int|public|private|void|return|if|for|while|import|include)\b/m.test(text) ||
        text.trim().startsWith("//") ||
        text.trim().startsWith("#"));

    if (isCode) {
      e.preventDefault();
      const blockHtml = createCodeBlockHtml(text, "code");
      document.execCommand("insertHTML", false, blockHtml);
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

  const getHighlightBtnClass = (isActive: boolean) =>
    cn(
      "p-1.5 rounded-lg transition-all cursor-pointer text-xs flex items-center justify-center gap-1",
      isActive
        ? "bg-cyan-500/20 text-cyan-200 border border-cyan-500/40 shadow-[0_0_12px_rgba(6,182,212,0.3)]"
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

          {/* Prime AI Highlight Notation / Term Button */}
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              toggleHighlight();
            }}
            className={getHighlightBtnClass(activeFormats.highlight)}
            title="Highlight Notation / Term (Ctrl+H)"
          >
            <Highlighter className="w-4 h-4" />
          </button>

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
            onClick={handleEditorClick}
            onKeyDown={handleEditorKeyDown}
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
              "[&_p]:my-1.5 [&_p]:text-sm [&_p]:sm:text-base [&_p]:text-zinc-100",
              "[&_code]:bg-violet-500/15 [&_code]:border [&_code]:border-violet-500/30 [&_code]:text-cyan-300 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono",
              // Collapsible Code Block Container Styles
              "[&_.code-block-container]:my-3 [&_.code-block-container]:rounded-xl [&_.code-block-container]:border [&_.code-block-container]:border-white/10 [&_.code-block-container]:bg-[#080914] [&_.code-block-container]:overflow-hidden [&_.code-block-container]:shadow-md",
              "[&_.code-content]:p-3 [&_.code-content]:text-xs [&_.code-content]:font-mono [&_.code-content]:text-cyan-200 [&_.code-content]:leading-relaxed [&_.code-content]:overflow-x-auto [&_.code-content]:whitespace-pre [&_.code-content]:outline-none",
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
