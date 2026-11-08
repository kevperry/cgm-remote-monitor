/* Scripture reference parsing & normalization.
 * Exposes window.Bible = { books, parse(str), format(ref), matches(ref, query) }
 */
(function () {
  'use strict';

  // Canonical order (Protestant 66). [name, extra aliases]
  var BOOKS = [
    ['Genesis', 'gn'], ['Exodus', 'ex exo'], ['Leviticus', 'lv'], ['Numbers', 'nm nb'], ['Deuteronomy', 'dt'],
    ['Joshua', 'jos jsh'], ['Judges', 'jdg jgs'], ['Ruth', 'rth'], ['1 Samuel', '1sm'], ['2 Samuel', '2sm'],
    ['1 Kings', '1kgs 1ki'], ['2 Kings', '2kgs 2ki'], ['1 Chronicles', '1chr'], ['2 Chronicles', '2chr'],
    ['Ezra', ''], ['Nehemiah', ''], ['Esther', ''], ['Job', 'jb'], ['Psalms', 'ps psalm pss psa'],
    ['Proverbs', 'prv'], ['Ecclesiastes', 'eccl qoh qoheleth'], ['Song of Songs', 'song sos songofsolomon canticles cant ss'],
    ['Isaiah', ''], ['Jeremiah', ''], ['Lamentations', ''], ['Ezekiel', 'ezk'], ['Daniel', 'dn'],
    ['Hosea', ''], ['Joel', 'jl'], ['Amos', ''], ['Obadiah', ''], ['Jonah', 'jnh'], ['Micah', ''],
    ['Nahum', ''], ['Habakkuk', ''], ['Zephaniah', ''], ['Haggai', ''], ['Zechariah', ''], ['Malachi', ''],
    ['Matthew', 'mt'], ['Mark', 'mk mrk'], ['Luke', 'lk'], ['John', 'jn jhn'], ['Acts', ''],
    ['Romans', 'rm'], ['1 Corinthians', ''], ['2 Corinthians', ''], ['Galatians', ''], ['Ephesians', ''],
    ['Philippians', 'php phil'], ['Colossians', ''], ['1 Thessalonians', ''], ['2 Thessalonians', ''],
    ['1 Timothy', ''], ['2 Timothy', ''], ['Titus', ''], ['Philemon', 'phlm phm philem'], ['Hebrews', ''],
    ['James', 'jas jm'], ['1 Peter', '1pt'], ['2 Peter', '2pt'], ['1 John', '1jn 1jhn'], ['2 John', '2jn'],
    ['3 John', '3jn'], ['Jude', 'jud'], ['Revelation', 'rv apocalypse revelations']
  ];

  var books = BOOKS.map(function (b, i) {
    return { name: b[0], index: i, key: key(b[0]), aliases: b[1] ? b[1].split(' ') : [] };
  });

  function key(s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ''); }

  function normalizeOrdinal(s) {
    return s.replace(/^\s*(iii|third|3rd)\b\.?\s*/i, '3 ')
            .replace(/^\s*(ii|second|2nd)\b\.?\s*/i, '2 ')
            .replace(/^\s*(i|first|1st)\b\.?\s+/i, '1 ');
  }

  function findBook(raw) {
    var k = key(normalizeOrdinal(raw));
    if (!k) return null;
    var i, b;
    // exact name or alias
    for (i = 0; i < books.length; i++) {
      b = books[i];
      if (b.key === k || b.aliases.indexOf(k) !== -1) return b;
    }
    // prefix of canonical name (needs at least 2 letters beyond a leading number)
    var letters = k.replace(/^\d/, '');
    if (letters.length < 2) return null;
    for (i = 0; i < books.length; i++) {
      b = books[i];
      if (b.key.indexOf(k) === 0) return b;
    }
    return null;
  }

  // Parse "1 Cor 13:4-7", "Ps 23", "John 3:16–18", "Romans" -> {book, bookIndex, chapter, verse, verseEnd}
  var RE = /^\s*((?:[1-3]|i{1,3}|first|second|third|1st|2nd|3rd)?\s*\.?\s*[a-z][a-z .]*?)\s*(\d+)?\s*(?:[:.]\s*(\d+)(?:\s*[-–—]\s*(\d+))?)?\s*$/i;

  function parse(str) {
    if (!str) return null;
    var m = RE.exec(String(str));
    if (!m) return null;
    var b = findBook(m[1]);
    if (!b) return null;
    return {
      book: b.name,
      bookIndex: b.index,
      chapter: m[2] ? parseInt(m[2], 10) : null,
      verse: m[3] ? parseInt(m[3], 10) : null,
      verseEnd: m[4] ? parseInt(m[4], 10) : null
    };
  }

  function format(r) {
    if (!r) return '';
    // "Psalm 23" reads more naturally than "Psalms 23"
    var s = r.book === 'Psalms' && r.chapter ? 'Psalm' : r.book;
    if (r.chapter) s += ' ' + r.chapter;
    if (r.chapter && r.verse) s += ':' + r.verse;
    if (r.verseEnd) s += '–' + r.verseEnd;
    return s;
  }

  // Does stored ref r fall within the query ref q? (q may be book only, book+chapter, or a verse span)
  function matches(r, q) {
    if (!r || !q || r.bookIndex !== q.bookIndex) return false;
    if (!q.chapter) return true;
    if (r.chapter == null) return false;
    if (r.chapter !== q.chapter) return false;
    if (!q.verse || r.verse == null) return true;
    var rs = r.verse, re = r.verseEnd || r.verse;
    var qs = q.verse, qe = q.verseEnd || q.verse;
    return rs <= qe && qs <= re;
  }

  // Sort key for ordering refs canonically
  function sortKey(r) {
    return r.bookIndex * 1e6 + (r.chapter || 0) * 1e3 + (r.verse || 0);
  }

  window.Bible = { books: books, parse: parse, format: format, matches: matches, sortKey: sortKey };
})();
