// Fast CSV reader: an exact drop-in for csv-reader 1.0.0 (make.fun's reference
// program). run(input) returns the reference's answer for every input — the
// same {columns, rows, errors} for each {text, header} — but faster.
//
// The reference reads one character at a time, building each field a character
// at a time. This reader reads the same way in meaning, but in bulk: it finds
// each field's end with one regex scan (a C++ scan that stops at the first
// comma, CR or LF) and cuts the field out with one slice, and it takes whole
// clean records in a single split. No character is ever appended one at a
// time, and no value is ever re-scanned.
//
// The policy below is the reference's own, restated from its documentation:
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no
//     record;
//   - outside a quoted field a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not
//     doubled, "" inside it one quote and each CRLF or lone CR inside it read
//     as LF; what follows its closing quote, up to the next comma or line
//     break, is appended as it stands (quote_junk, when the field ends); a
//     quote that never closes is a literal character, and the text after it is
//     read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character;
//   - fields stay strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds
//     the records after it (every record when header is false), each padded
//     with "" (short_row, with fields: its field count) or cut (long_row, with
//     extra: the cut fields) to the first record's width;
//   - each error is {code, line, row}, in the order met, a record's short_row
//     or long_row when it ends: line the 1-based line its record starts on,
//     counting every LF, CRLF and lone CR inside quotes, and row its record's
//     index in rows, null for the header.
//
// Pure: no clock, no randomness, no locale, nothing kept from one call to the
// next. Each case is answered alone.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

// One scan for the next field delimiter: a single regex stops at the first
// comma, CR or LF, where three indexOf calls would each run on — the CR one
// unbounded, to the next CR anywhere in the file.
const DELIM = /[,\r\n]/g;
// One scan for the next quote or CR before a record's line break.
const QUOTE_OR_CR = /["\r]/g;

/** csv-reader 1.0.0's answer for one case's input, faster. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it
  // takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // Field results travel in these closure slots instead of a fresh object
  // per field: ~700k fields would each allocate a return value otherwise.
  let fValue = '';
  let fEnded = 0;
  let fAdded = 0;

  // Reads unquoted characters onto `value` up to the next comma or line
  // break: a CR not followed by LF is dropped (stray_cr). Sets fValue,
  // fEnded and fAdded; fAdded counts the characters kept. A field that is a
  // single chunk is the slice itself, never a concatenation.
  function readUnquoted(value) {
    let added = 0;
    for (;;) {
      DELIM.lastIndex = pos;
      const m = DELIM.exec(text);
      if (m === null) {
        const n = len - pos;
        if (n > 0) {
          if (value === '') value = text.slice(pos, len);
          else value += text.slice(pos, len);
          added += n;
        }
        pos = len;
        fValue = value;
        fEnded = END;
        fAdded = added;
        return;
      }
      const end = m.index;
      const d = text.charCodeAt(end);
      if (d === 13) {
        if (text.charCodeAt(end + 1) === 10) {
          const n = end - pos;
          if (n > 0) {
            if (value === '') value = text.slice(pos, end);
            else value += text.slice(pos, end);
            added += n;
          }
          pos = end + 2;
          line += 1;
          fValue = value;
          fEnded = LINE_BREAK;
          fAdded = added;
          return;
        }
        // A stray CR: dropped, the field goes on after it.
        const n = end - pos;
        if (n > 0) {
          if (value === '') value = text.slice(pos, end);
          else value += text.slice(pos, end);
          added += n;
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        pos = end + 1;
        continue;
      }
      const n = end - pos;
      if (n > 0) {
        if (value === '') value = text.slice(pos, end);
        else value += text.slice(pos, end);
        added += n;
      }
      pos = end + 1;
      if (d === 10) line += 1;
      fValue = value;
      fEnded = d === 44 ? COMMA : LINE_BREAK;
      fAdded = added;
      return;
    }
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    // The closing quote: the next quote that is not doubled.
    let p = pos + 1;
    let hasDoubled = false;
    let close = -1;
    for (;;) {
      const q = text.indexOf('"', p);
      if (q === -1) break;
      if (text.charCodeAt(q + 1) === 34) {
        hasDoubled = true;
        p = q + 2;
        continue;
      }
      close = q;
      break;
    }
    if (close === -1) {
      // The quote never closes: it is a literal character, and the text
      // after it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      readUnquoted('"');
      return;
    }
    const start = open + 1;
    let value;
    // The span itself is a slice (a view, not a copy), so checking it for
    // CRs and LFs stays inside the span instead of running on to the next
    // CR anywhere in the file.
    const span = text.slice(start, close);
    const hasCr = span.indexOf('\r') !== -1;
    const hasLf = span.indexOf('\n') !== -1;
    if (!hasCr && !hasLf) {
      value = hasDoubled ? span.replace(/""/g, '"') : span;
    } else {
      // Each CRLF or lone CR inside quotes reads as one LF, and counts one
      // line; "" inside reads as one quote.
      const breaks = span.match(/\r\n|\r|\n/g);
      if (breaks !== null) line += breaks.length;
      value = hasDoubled
        ? span.replace(/\r\n?/g, '\n').replace(/""/g, '"')
        : span.replace(/\r\n?/g, '\n');
    }
    pos = close + 1;
    if (pos >= len) {
      fValue = value;
      fEnded = END;
      fAdded = 0;
      return;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fValue = value;
      fEnded = COMMA;
      fAdded = 0;
      return;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fValue = value;
      fEnded = LINE_BREAK;
      fAdded = 0;
      return;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fValue = value;
      fEnded = LINE_BREAK;
      fAdded = 0;
      return;
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    readUnquoted(value);
    if (fAdded > 0) {
      errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    }
  }

  // The record's fields, once read: the header, or a row at the first
  // record's width.
  function finishRecord(fields) {
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  while (pos < len) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // A whole clean record at once: no quote opens before its line break,
    // and no CR but the CRLF that ends it, so its fields are the plain
    // comma-separated pieces of the line.
    const nl = text.indexOf('\n', pos);
    const recEnd = nl === -1 ? len : nl;
    QUOTE_OR_CR.lastIndex = pos;
    const mq = QUOTE_OR_CR.exec(text);
    const qpos = mq === null ? -1 : mq.index;
    if (qpos === -1 || qpos >= recEnd) {
      finishRecord(text.slice(pos, recEnd).split(','));
      pos = nl === -1 ? len : nl + 1;
      if (nl !== -1) line += 1;
      continue;
    }
    if (nl !== -1 && qpos === recEnd - 1 && text.charCodeAt(qpos) === 13) {
      finishRecord(text.slice(pos, recEnd - 1).split(','));
      pos = nl + 1;
      line += 1;
      continue;
    }

    const fields = [];
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      if (quoted) readQuoted();
      else readUnquoted('');
      fields.push(fValue);
    } while (fEnded === COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    finishRecord(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
