/*
 * The blog's markdown, rendered to HTML. One renderer, used twice: by the API
 * for the admin page's live preview, and by build.js for the published page,
 * so what staff preview is byte for byte what gets published.
 *
 * Deliberately a small subset, written here rather than pulled in, because
 * the output goes straight into pages on this origin:
 *
 *   ## Heading / ### Subheading     (a single # is treated as ##: the post
 *                                    title is the page's only <h1>)
 *   paragraphs, **bold**, *italic*, `code`, [link](url), ![alt](image)
 *   - bullets, 1. numbered lists, > quotes, ``` code blocks, --- rules
 *   | pipe | tables |
 *
 * There is no raw HTML. Every character of text is escaped, and a URL is only
 * emitted if it is http(s), mailto:, tel:, an in-page #anchor or a path on
 * this site. Styling is by element under .blog-prose in src/input.css, so
 * nothing here depends on Tailwind seeing a class name.
 */

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function safeUrl(u, { image = false } = {}) {
  const s = String(u || '').trim();
  if (!s) return null;
  if (s.startsWith('/') && !s.startsWith('//')) return s;
  if (!image && s.startsWith('#')) return s;
  try {
    const p = new URL(s).protocol;
    if (p === 'https:' || (!image && (p === 'http:' || p === 'mailto:' || p === 'tel:'))) return s;
  } catch {}
  return null;
}

const slugify = (s) =>
  String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

/** Inline markup on one already-split run of text. */
function inline(src, opts) {
  let out = '';
  let i = 0;
  const s = String(src);
  while (i < s.length) {
    const rest = s.slice(i);
    let m;
    if ((m = /^`([^`]+)`/.exec(rest))) {
      out += `<code>${esc(m[1])}</code>`;
    } else if ((m = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/.exec(rest))) {
      const url = safeUrl(m[2], { image: true });
      out += url ? opts.image({ src: url, alt: m[1], title: m[3] || '' }) : esc(m[0]);
    } else if ((m = /^\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/.exec(rest))) {
      const url = safeUrl(m[2]);
      if (!url) out += esc(m[0]);
      else {
        const external = /^(https?:)?\/\//.test(url) && !url.startsWith(opts.site || '\u0000');
        out += `<a href="${esc(url)}"${m[3] ? ` title="${esc(m[3])}"` : ''}${external ? ' rel="noopener" target="_blank"' : ''}>${inline(m[1], opts)}</a>`;
      }
    } else if ((m = /^\*\*([^*]+(?:\*(?!\*)[^*]*)*)\*\*/.exec(rest)) || (m = /^__([^_]+)__/.exec(rest))) {
      out += `<strong>${inline(m[1], opts)}</strong>`;
    } else if ((m = /^\*([^*\s][^*]*?)\*/.exec(rest)) || (m = /^_([^_\s][^_]*?)_(?![a-z0-9])/i.exec(rest))) {
      out += `<em>${inline(m[1], opts)}</em>`;
    } else if ((m = /^ {2,}\n|^\\\n/.exec(rest))) {
      out += '<br>';
    } else {
      // Plain text up to the next character that could open markup.
      m = /^[^`!\[*_\\ ]+|^[\s\S]/.exec(rest);
      out += esc(m[0]);
    }
    i += m[0].length;
  }
  return out;
}

const defaultImage = ({ src, alt, title }) =>
  `<img src="${esc(src)}" alt="${esc(alt)}"${title ? ` title="${esc(title)}"` : ''} loading="lazy" decoding="async">`;

/**
 * markdown -> { html, headings: [{level, text, id}], words, images: [src] }
 *
 * opts.image({src, alt, title}) renders an image (build.js uses it to swap in
 * the re-encoded, sized copy); opts.site is this site's origin, so absolute
 * links to it are not treated as external.
 */
function render(md, opts = {}) {
  const o = { image: opts.image || defaultImage, site: opts.site || '' };
  const lines = String(md || '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  const html = [];
  const headings = [];
  const images = [];
  const ids = new Set();
  let words = 0;

  const count = (t) => {
    words += (String(t).match(/[\p{L}\p{N}]+/gu) || []).length;
  };
  const collect = (t) => {
    for (const m of String(t).matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)) {
      const u = safeUrl(m[1], { image: true });
      if (u) images.push(u);
    }
  };
  const para = (t) => {
    count(t);
    collect(t);
    return inline(t, o);
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let m;

    if (!line.trim()) {
      i++;
      continue;
    }

    // ``` fenced code
    if ((m = /^```\s*([\w+-]*)\s*$/.exec(line))) {
      const body = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++;
      html.push(`<pre><code${m[1] ? ` data-lang="${esc(m[1])}"` : ''}>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }

    // ## headings
    if ((m = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line))) {
      const level = Math.min(Math.max(m[1].length, 2), 4);
      const text = m[2];
      let id = slugify(text.replace(/[*_`]/g, '')) || 'section';
      for (let n = 2; ids.has(id); n++) id = `${slugify(text)}-${n}`;
      ids.add(id);
      count(text);
      headings.push({ level, text: text.replace(/[*_`]/g, ''), id });
      html.push(`<h${level} id="${id}">${inline(text, o)}</h${level}>`);
      i++;
      continue;
    }

    // --- rule
    if (/^(\*\s*){3,}$|^(-\s*){3,}$|^(_\s*){3,}$/.test(line.trim())) {
      html.push('<hr>');
      i++;
      continue;
    }

    // > quote
    if (/^>\s?/.test(line)) {
      const body = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ''));
      html.push(`<blockquote>${render(body.join('\n'), o).html}</blockquote>`);
      count(body.join(' '));
      continue;
    }

    // - / 1. lists (one level, with lazy continuation lines)
    if ((m = /^\s*([-*+]|\d+[.)])\s+/.exec(line))) {
      const ordered = /\d/.test(m[1]);
      const re = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/;
      const items = [];
      while (i < lines.length && lines[i].trim()) {
        if (re.test(lines[i])) items.push(lines[i].replace(re, ''));
        else if (items.length) items[items.length - 1] += '\n' + lines[i].trim();
        else break;
        i++;
      }
      const start = ordered ? parseInt(m[1], 10) : 1;
      const tag = ordered ? 'ol' : 'ul';
      html.push(`<${tag}${ordered && start !== 1 ? ` start="${start}"` : ''}>${items.map((t) => `<li>${para(t)}</li>`).join('')}</${tag}>`);
      continue;
    }

    // | tables | (header row, then |---| separator)
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      html.push(
        `<div class="blog-table"><table><thead><tr>${head.map((c) => `<th scope="col">${para(c)}</th>`).join('')}</tr></thead>` +
          `<tbody>${rows.map((r) => `<tr>${head.map((_, j) => `<td>${para(r[j] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
      );
      continue;
    }

    // A line that is only an image becomes a figure, its alt text the caption source.
    if ((m = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)\s*$/.exec(line.trim()))) {
      const url = safeUrl(m[2], { image: true });
      if (url) {
        images.push(url);
        html.push(`<figure>${o.image({ src: url, alt: m[1], title: m[3] || '' })}${m[3] ? `<figcaption>${esc(m[3])}</figcaption>` : ''}</figure>`);
        i++;
        continue;
      }
    }

    // Paragraph: consecutive non-blank lines that start nothing else.
    const body = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,4}\s|```|>|\s*([-*+]|\d+[.)])\s+|\s*\|.*\|\s*$)/.test(lines[i]) &&
      !/^(-\s*){3,}$/.test(lines[i].trim())
    )
      body.push(lines[i++]);
    html.push(`<p>${para(body.join('\n'))}</p>`);
  }

  return { html: html.join('\n'), headings, words, images };
}

/** Plain text of a markdown string, for descriptions and feeds. */
function plain(md) {
  return String(md || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*([-*+]|\d+[.)]|>)\s+/gm, '')
    .replace(/[*_`|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { render, plain, slugify, esc, safeUrl };
