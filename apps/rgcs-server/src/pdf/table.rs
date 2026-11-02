//! Fixed-column table with wrapped cells, bilingual headers and page breaks.

use super::text::{em_mm, wrap};
use super::{Doc, MARGIN};

pub const PAD: f32 = 1.5;

pub struct Col {
    pub ja: &'static str,
    pub en: &'static str,
    pub width_mm: f32,
}

pub struct Table<'a> {
    pub cols: &'a [Col],
    pub body_pt: f32,
    pub head_ja_pt: f32,
    pub head_en_pt: f32,
}

pub fn line_h(size_pt: f32) -> f32 {
    em_mm(size_pt) * 1.35
}

impl<'a> Table<'a> {
    pub fn new(cols: &'a [Col]) -> Self {
        Self {
            cols,
            body_pt: 8.0,
            head_ja_pt: 7.5,
            head_en_pt: 5.5,
        }
    }

    fn header_height(&self) -> f32 {
        let ja_lines = self
            .cols
            .iter()
            .map(|c| wrap(c.ja, c.width_mm - 2.0 * PAD, self.head_ja_pt).len())
            .max()
            .unwrap_or(1);
        let en_lines = self
            .cols
            .iter()
            .map(|c| wrap(c.en, c.width_mm - 2.0 * PAD, self.head_en_pt).len())
            .max()
            .unwrap_or(1);
        ja_lines as f32 * line_h(self.head_ja_pt) + en_lines as f32 * line_h(self.head_en_pt) + 2.0 * PAD
    }

    fn draw_header(&self, doc: &mut Doc) {
        let h = self.header_height();
        let top = doc.cursor();
        let mut x = MARGIN;
        for c in self.cols {
            doc.rect(x, top, c.width_mm, h);
            let mut y = top + PAD + em_mm(self.head_ja_pt);
            for l in wrap(c.ja, c.width_mm - 2.0 * PAD, self.head_ja_pt) {
                doc.text(x + PAD, y, self.head_ja_pt, &l);
                y += line_h(self.head_ja_pt);
            }
            y = y - line_h(self.head_ja_pt) + line_h(self.head_en_pt);
            for l in wrap(c.en, c.width_mm - 2.0 * PAD, self.head_en_pt) {
                doc.text(x + PAD, y, self.head_en_pt, &l);
                y += line_h(self.head_en_pt);
            }
            x += c.width_mm;
        }
        doc.set_cursor(top + h);
    }

    fn row_lines(&self, row: &[String]) -> Vec<Vec<String>> {
        self.cols
            .iter()
            .enumerate()
            .map(|(i, c)| {
                wrap(
                    row.get(i).map(String::as_str).unwrap_or(""),
                    c.width_mm - 2.0 * PAD,
                    self.body_pt,
                )
            })
            .collect()
    }

    fn draw_row(&self, doc: &mut Doc, lines: &[Vec<String>], h: f32) {
        let top = doc.cursor();
        let mut x = MARGIN;
        for (c, cell) in self.cols.iter().zip(lines) {
            doc.rect(x, top, c.width_mm, h);
            let mut y = top + PAD + em_mm(self.body_pt);
            for l in cell {
                doc.text(x + PAD, y, self.body_pt, l);
                y += line_h(self.body_pt);
            }
            x += c.width_mm;
        }
        doc.set_cursor(top + h);
    }

    /// Draws the header and every row from the document cursor; rows never split across pages
    /// and the header is repeated after each break. Leaves the cursor below the table.
    pub fn draw(&self, doc: &mut Doc, rows: &[Vec<String>]) {
        if doc.cursor() + self.header_height() + line_h(self.body_pt) + 2.0 * PAD > doc.bottom() {
            doc.new_page();
        }
        self.draw_header(doc);
        for row in rows {
            let lines = self.row_lines(row);
            let n = lines.iter().map(Vec::len).max().unwrap_or(1).max(1);
            let h = n as f32 * line_h(self.body_pt) + 2.0 * PAD;
            if doc.cursor() + h > doc.bottom() {
                doc.new_page();
                self.draw_header(doc);
            }
            self.draw_row(doc, &lines, h);
        }
        doc.advance(2.0);
    }
}
