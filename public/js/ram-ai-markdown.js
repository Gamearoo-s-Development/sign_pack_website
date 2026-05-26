/**
 * Safe lightweight markdown for Ram AI responses (XSS-safe).
 */
(function (global) {
  var TRANSPORT_INLINE_RE =
    /\[stream_end\]|\[STREAM_END\]|\[DONE\]|\[done\]|\[END\]|\[end\]/gi;

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function cleanupResponseText(raw, final) {
    if (raw == null) return "";
    var s = String(raw);
    s = s.replace(TRANSPORT_INLINE_RE, "");
    s = s.replace(/^\s*data:\s*/gm, "");
    s = s.replace(/\r\n/g, "\n");
    if (final) {
      s = s.replace(/\n{4,}/g, "\n\n\n");
      s = s.replace(/[ \t]+\n/g, "\n");
      s = s.trim();
    }
    return s;
  }

  function inlineFormat(escaped) {
    var s = escaped;
    s = s.replace(/`([^`\n]+)`/g, "<code class=\"ram-ai-md-code\">$1</code>");
    s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\*([^*\n]+)\*/g, "<strong>$1</strong>");
    return s;
  }

  function renderList(lines, ordered) {
    var tag = ordered ? "ol" : "ul";
    var html = "<" + tag + " class=\"ram-ai-md-list\">";
    for (var i = 0; i < lines.length; i++) {
      html += "<li>" + inlineFormat(escapeHtml(lines[i])) + "</li>";
    }
    return html + "</" + tag + ">";
  }

  function renderMarkdown(raw, options) {
    var opts = options || {};
    var text = cleanupResponseText(raw, !!opts.final);
    if (!text.trim()) return "";

    var parts = text.split(/```/);
    var out = [];

    for (var p = 0; p < parts.length; p++) {
      if (p % 2 === 1) {
        var code = parts[p].replace(/^\w*\n/, "");
        out.push(
          "<pre class=\"ram-ai-md-pre\"><code>" + escapeHtml(code.trim()) + "</code></pre>"
        );
        continue;
      }

      var blocks = parts[p].split(/\n\n+/);
      for (var b = 0; b < blocks.length; b++) {
        var block = blocks[b];
        if (!block.trim()) continue;

        var lines = block.split("\n");
        var heading = lines[0].match(/^(#{1,3})\s+(.+)$/);
        if (heading && lines.length === 1) {
          var level = heading[1].length;
          var tag = "h" + Math.min(level + 2, 4);
          out.push(
            "<" +
              tag +
              ' class="ram-ai-md-heading">' +
              inlineFormat(escapeHtml(heading[2])) +
              "</" +
              tag +
              ">"
          );
          continue;
        }

        var bulletLines = [];
        var orderedLines = [];
        var paraLines = [];
        var mode = "para";

        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          var bullet = line.match(/^\s*[-*•]\s+(.+)$/);
          var ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
          if (bullet) {
            if (mode === "ordered") {
              if (orderedLines.length) out.push(renderList(orderedLines, true));
              orderedLines = [];
            }
            mode = "bullet";
            bulletLines.push(bullet[1]);
          } else if (ordered) {
            if (mode === "bullet") {
              if (bulletLines.length) out.push(renderList(bulletLines, false));
              bulletLines = [];
            }
            mode = "ordered";
            orderedLines.push(ordered[1]);
          } else {
            if (mode === "bullet" && bulletLines.length) {
              out.push(renderList(bulletLines, false));
              bulletLines = [];
            }
            if (mode === "ordered" && orderedLines.length) {
              out.push(renderList(orderedLines, true));
              orderedLines = [];
            }
            mode = "para";
            paraLines.push(line);
          }
        }

        if (bulletLines.length) out.push(renderList(bulletLines, false));
        if (orderedLines.length) out.push(renderList(orderedLines, true));
        if (paraLines.length) {
          var paraText = paraLines.join("\n");
          var paraHtml = inlineFormat(escapeHtml(paraText));
          paraHtml = paraHtml.replace(/\n/g, "<br>\n");
          out.push('<p class="ram-ai-md-p">' + paraHtml + "</p>");
        }
      }
    }

    return '<div class="ram-ai-markdown">' + out.join("") + "</div>";
  }

  global.RamAiMarkdown = {
    escapeHtml: escapeHtml,
    cleanupResponseText: cleanupResponseText,
    render: renderMarkdown,
  };
})(typeof window !== "undefined" ? window : global);
