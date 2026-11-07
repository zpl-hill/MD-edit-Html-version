/* docxConverter.js — Marked token → docx.js 元素树（L3 纯逻辑，可单测）。 */
import { stripTags } from "./sanitizer.js";
import { texToOmml, splitMathSegments, standaloneMath } from "./omml.js";
import { AUTHOR_DOCX_CREATOR } from "./author.js";

function D() { return globalThis.docx; }

function textFallback(token) {
  return [{ type: 'text', text: token.text || '' }];
}

/* LaTeX math segment -> Word native OMML component; degrade to visible source on failure. */
function mathComponent(seg, ctx, style) {
  const d = D();
  const xml = texToOmml(seg.tex);
  if (xml) {
    try {
      const node = d.ImportedXmlComponent.fromXmlString(xml);
      ctx.mathCount = (ctx.mathCount || 0) + 1;
      return node;
    } catch (e) { /* fall through to source text */ }
  }
  ctx.mathFailures = (ctx.mathFailures || 0) + 1;
  return new d.TextRun(Object.assign({ text: seg.raw, font: 'Consolas', color: 'A31515' }, style));
}

async function inline(tokens, style, ctx) {
  const d = D();
  const runs = [];
  for (const token of (tokens || [])) {
    switch (token.type) {
      case 'text': {
        for (const seg of splitMathSegments(token.text || '')) {
          if (seg.type === 'math') runs.push(mathComponent(seg, ctx, style));
          else if (seg.value) runs.push(new d.TextRun(Object.assign({ text: seg.value }, style)));
        }
        break;
      }
      case 'strong':
        runs.push(...await inline(token.tokens || textFallback(token), Object.assign({}, style, { bold: true }), ctx));
        break;
      case 'em':
        runs.push(...await inline(token.tokens || textFallback(token), Object.assign({}, style, { italics: true }), ctx));
        break;
      case 'del':
        runs.push(...await inline(token.tokens || textFallback(token), Object.assign({}, style, { strike: true }), ctx));
        break;
      case 'codespan':
        runs.push(new d.TextRun({ text: token.text || '', font: 'Consolas', color: 'A31515' }));
        break;
      case 'link':
        runs.push(new d.ExternalHyperlink({
          link: token.href || '',
          children: await inline(token.tokens || textFallback(token),
            Object.assign({}, style, { color: '0563C1', underline: {} }), ctx)
        }));
        break;
      case 'image': {
        const image = await ctx.resolveImage(token.href || '');
        if (image) {
          ctx.imageCount = (ctx.imageCount || 0) + 1;
          runs.push(new d.ImageRun({
            data: image.data,
            transformation: { width: image.width, height: image.height },
            type: image.type
          }));
        } else {
          ctx.imageFailures = (ctx.imageFailures || 0) + 1;
          runs.push(new d.TextRun({ text: '[图片: ' + (token.text || token.href || '') + ']', italics: true, color: '888888' }));
        }
        break;
      }
      case 'br':
        runs.push(new d.TextRun({ break: 1 }));
        break;
      case 'html':
        runs.push(new d.TextRun(Object.assign({ text: stripTags(token.text || '') }, style)));
        break;
      default:
        if (token.tokens) runs.push(...await inline(token.tokens, style, ctx));
        else if (token.text) runs.push(new d.TextRun(Object.assign({ text: token.text }, style)));
    }
  }
  return runs;
}

async function makeCell(cell, isHeader, ctx) {
  const d = D();
  const alignMap = {
    center: d.AlignmentType.CENTER, right: d.AlignmentType.RIGHT, left: d.AlignmentType.LEFT
  };
  const runs = await inline(cell.tokens || textFallback(cell), isHeader ? { bold: true } : {}, ctx);
  return new d.TableCell({
    children: [new d.Paragraph({
      alignment: alignMap[cell.align] || d.AlignmentType.LEFT,
      children: runs.length ? runs : [new d.TextRun('')]
    })]
  });
}

async function convertTable(token, ctx) {
  const d = D();
  const rows = [];
  if (token.header) {
    rows.push(new d.TableRow({
      tableHeader: true,
      children: await Promise.all(token.header.map(cell => makeCell(cell, true, ctx)))
    }));
  }
  for (const row of (token.rows || [])) {
    rows.push(new d.TableRow({ children: await Promise.all(row.map(cell => makeCell(cell, false, ctx))) }));
  }
  return new d.Table({ rows });
}

async function convertBlock(token, ctx) {
  const d = D();
  switch (token.type) {
    case 'heading':
      return [new d.Paragraph({
        heading: d.HeadingLevel['HEADING_' + Math.min(6, Math.max(1, token.depth || 1))],
        children: await inline(token.tokens || textFallback(token), {}, ctx)
      })];
    case 'paragraph':
    case 'text': {
      const displayTex = standaloneMath(token.text || '');
      if (displayTex) {
        const xml = texToOmml(displayTex);
        if (xml) {
          try {
            ctx.mathCount = (ctx.mathCount || 0) + 1;
            return [new d.Paragraph({
              alignment: d.AlignmentType.CENTER,
              children: [d.ImportedXmlComponent.fromXmlString(xml)]
            })];
          } catch (e) { /* fall through */ }
        }
        ctx.mathFailures = (ctx.mathFailures || 0) + 1;
        return [new d.Paragraph({
          alignment: d.AlignmentType.CENTER,
          children: [new d.TextRun({ text: token.text, font: 'Consolas', color: 'A31515' })]
        })];
      }
      /* 独占一段的图片在 Word 里居中，更贴近 8D / MSA 报告的截图排版。 */
      const kids = token.tokens || [];
      const onlyImage = kids.length === 1 && kids[0].type === 'image';
      return [new d.Paragraph({
        alignment: onlyImage ? d.AlignmentType.CENTER : undefined,
        children: await inline(kids.length ? kids : textFallback(token), {}, ctx)
      })];
    }
    case 'code': {
      const lines = String(token.text || '').split('\n');
      return lines.map(line => new d.Paragraph({
        indent: { left: 360 },
        children: [new d.TextRun({ text: line || ' ', font: 'Consolas', size: 19 })]
      }));
    }
    case 'blockquote': {
      const inner = [];
      for (const child of (token.tokens || [])) inner.push(...await convertBlock(child, ctx));
      return inner.map(p => p);
    }
    case 'list': {
      const reference = token.ordered ? 'mdsl-number' : 'mdsl-bullet';
      const out = [];
      for (const item of (token.items || [])) {
        out.push(new d.Paragraph({
          numbering: { reference, level: 0 },
          children: await inline(item.tokens || textFallback(item), {}, ctx)
        }));
      }
      return out;
    }
    case 'table':
      return [await convertTable(token, ctx)];
    case 'hr':
      return [new d.Paragraph({ children: [new d.TextRun('──────────────────────────────')] })];
    case 'html':
      return [new d.Paragraph({ children: [new d.TextRun(stripTags(token.text || ''))] })];
    case 'space':
      return [];
    default:
      if (token.tokens) {
        const out = [];
        for (const child of token.tokens) out.push(...await convertBlock(child, ctx));
        return out;
      }
      return token.text ? [new d.Paragraph({ children: [new d.TextRun(token.text)] })] : [];
  }
}

export async function convertTokens(tokens, options) {
  const d = D();
  if (!d || !d.Document) throw new Error('docx.js 未加载，请检查发布包完整性');
  const ctx = {
    resolveImage: options.resolveImage || (async () => null),
    imageCount: 0,
    imageFailures: 0,
    mathCount: 0,
    mathFailures: 0
  };
  const children = [];
  for (const token of (tokens || [])) children.push(...await convertBlock(token, ctx));

  const title = options.title || 'Markdown Studio Lite';
  const numbering = {
    config: [
      {
        reference: 'mdsl-bullet',
        levels: [{
          level: 0, format: 'bullet', text: '\u2022', alignment: d.AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } }
        }]
      },
      {
        reference: 'mdsl-number',
        levels: [{
          level: 0, format: d.NumberFormat.DECIMAL, text: '%1.', alignment: d.AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } }
        }]
      }
    ]
  };

  const footer = new d.Footer({
    children: [new d.Paragraph({
      alignment: d.AlignmentType.CENTER,
      children: [
        new d.TextRun('Page '),
        new d.TextRun({ children: [d.PageNumber.CURRENT] }),
        new d.TextRun(' of '),
        new d.TextRun({ children: [d.PageNumber.TOTAL_PAGES] })
      ]
    })]
  });
  const header = new d.Header({
    children: [new d.Paragraph({
      children: [new d.TextRun({ text: title, bold: true, size: 18, color: '666666' })]
    })]
  });

  const document = new d.Document({
    creator: AUTHOR_DOCX_CREATOR,
    lastModifiedBy: AUTHOR_DOCX_CREATOR,
    title,
    subject: title,
    description: '由 Markdown Studio Lite 生成 · 作者 ' + AUTHOR_DOCX_CREATOR,
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', size: 22 },
          paragraph: { spacing: { after: 120, line: 276 } }
        }
      }
    },
    numbering,
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 850, right: 1134, bottom: 850, left: 1134 }
        }
      },
      headers: { default: header },
      footers: { default: footer },
      children: children.length ? children : [new d.Paragraph('（空文档）')]
    }]
  });
  document.__mdslStats = {
    mathCount: ctx.mathCount,
    mathFailures: ctx.mathFailures,
    imageCount: ctx.imageCount,
    imageFailures: ctx.imageFailures
  };
  return document;
}
