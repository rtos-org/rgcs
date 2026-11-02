//! Server-side PDF generation for the MLIT logbook forms: a thin document
//! builder over `printpdf` with Noto Sans JP embedded, plus a wrap/table engine.

pub mod forms;
pub mod table;
pub mod text;

use std::sync::OnceLock;

use printpdf::{
    FontId, Line, LinePoint, Mm, Op, ParsedFont, PdfDocument, PdfFontHandle, PdfPage, PdfSaveOptions, Point,
    Pt, TextItem,
};

/// Noto Sans JP Regular (OFL, `assets/fonts/`), fetched by `scripts/sync-fonts.sh`.
const FONT_BYTES: &[u8] = include_bytes!("../../../../assets/fonts/NotoSansJP-Regular.otf");

pub const A4_W: f32 = 210.0;
pub const A4_H: f32 = 297.0;
pub const MARGIN: f32 = 10.0;
/// Space kept free at the bottom of every page (footer).
pub const FOOTER: f32 = 12.0;
const LINE_PT: f32 = 0.4;

fn parsed_font() -> &'static ParsedFont {
    static FONT: OnceLock<ParsedFont> = OnceLock::new();
    FONT.get_or_init(|| {
        let mut warnings = Vec::new();
        ParsedFont::from_bytes(FONT_BYTES, 0, &mut warnings).expect("bundled Noto Sans JP parses")
    })
}

/// Pages are built top-down in millimetres; `y` is the current writing position from the top.
pub struct Doc {
    doc: PdfDocument,
    font: FontId,
    pages: Vec<Vec<Op>>,
    ops: Vec<Op>,
    width: f32,
    height: f32,
    y: f32,
}

impl Doc {
    pub fn new(title: &str, landscape: bool) -> Self {
        let mut doc = PdfDocument::new(title);
        let font = doc.add_font(parsed_font());
        let (width, height) = if landscape { (A4_H, A4_W) } else { (A4_W, A4_H) };
        Self {
            doc,
            font,
            pages: Vec::new(),
            ops: Vec::new(),
            width,
            height,
            y: MARGIN,
        }
    }

    pub fn page_width(&self) -> f32 {
        self.width
    }

    pub fn page_height(&self) -> f32 {
        self.height
    }

    /// Lowest `y` content may reach before a page break.
    pub fn bottom(&self) -> f32 {
        self.height - FOOTER
    }

    pub fn cursor(&self) -> f32 {
        self.y
    }

    pub fn set_cursor(&mut self, y: f32) {
        self.y = y;
    }

    pub fn advance(&mut self, dy: f32) {
        self.y += dy;
    }

    pub fn page_count(&self) -> usize {
        self.pages.len() + 1
    }

    pub fn new_page(&mut self) {
        let ops = std::mem::take(&mut self.ops);
        self.pages.push(ops);
        self.y = MARGIN;
    }

    /// Writes `s` with its baseline at `y_mm` from the top.
    pub fn text(&mut self, x_mm: f32, y_mm: f32, size_pt: f32, s: &str) {
        if s.is_empty() {
            return;
        }
        self.ops.extend([
            Op::StartTextSection,
            Op::SetFont {
                font: PdfFontHandle::External(self.font.clone()),
                size: Pt(size_pt),
            },
            Op::SetTextCursor {
                pos: Point {
                    x: Mm(x_mm).into(),
                    y: Mm(self.height - y_mm).into(),
                },
            },
            Op::ShowText {
                items: vec![TextItem::Text(s.to_string())],
            },
            Op::EndTextSection,
        ]);
    }

    fn point(&self, x: f32, y: f32) -> LinePoint {
        LinePoint {
            p: Point {
                x: Mm(x).into(),
                y: Mm(self.height - y).into(),
            },
            bezier: false,
        }
    }

    pub fn line(&mut self, x1: f32, y1: f32, x2: f32, y2: f32) {
        let line = Line {
            points: vec![self.point(x1, y1), self.point(x2, y2)],
            is_closed: false,
        };
        self.ops.push(Op::SetOutlineThickness { pt: Pt(LINE_PT) });
        self.ops.push(Op::DrawLine { line });
    }

    /// Stroked rectangle with its top-left corner at `(x, y)`.
    pub fn rect(&mut self, x: f32, y: f32, w: f32, h: f32) {
        let line = Line {
            points: vec![
                self.point(x, y),
                self.point(x + w, y),
                self.point(x + w, y + h),
                self.point(x, y + h),
            ],
            is_closed: true,
        };
        self.ops.push(Op::SetOutlineThickness { pt: Pt(LINE_PT) });
        self.ops.push(Op::DrawLine { line });
    }

    /// Closes the current page, adds `p. N` footers and serialises with font subsetting.
    pub fn finish(mut self) -> Vec<u8> {
        let ops = std::mem::take(&mut self.ops);
        self.pages.push(ops);
        let total = self.pages.len();
        let (w, h) = (self.width, self.height);
        let font = self.font.clone();
        let pages: Vec<PdfPage> = std::mem::take(&mut self.pages)
            .into_iter()
            .enumerate()
            .map(|(i, mut ops)| {
                ops.extend(footer_ops(&font, w, h, i + 1, total));
                PdfPage::new(Mm(w), Mm(h), ops)
            })
            .collect();
        let mut warnings = Vec::new();
        let opts = PdfSaveOptions {
            subset_fonts: true,
            ..Default::default()
        };
        self.doc.with_pages(pages).save(&opts, &mut warnings)
    }
}

fn footer_ops(font: &FontId, w: f32, h: f32, n: usize, total: usize) -> Vec<Op> {
    vec![
        Op::StartTextSection,
        Op::SetFont {
            font: PdfFontHandle::External(font.clone()),
            size: Pt(7.0),
        },
        Op::SetTextCursor {
            pos: Point {
                x: Mm(w - MARGIN - 14.0).into(),
                y: Mm(h - (h - 6.0)).into(),
            },
        },
        Op::ShowText {
            items: vec![TextItem::Text(format!("p. {n} / {total}"))],
        },
        Op::EndTextSection,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_page_with_japanese_text_serialises_with_a_subset_font() {
        let mut d = Doc::new("test", false);
        d.text(10.0, 20.0, 12.0, "無人航空機の飛行記録 JOURNEY LOG");
        d.rect(10.0, 30.0, 100.0, 20.0);
        d.new_page();
        d.text(10.0, 20.0, 9.0, "二枚目");
        let bytes = d.finish();
        assert!(bytes.starts_with(b"%PDF-"));
        // printpdf 0.12 embeds the whole CFF font (subsetting is a no-op for it): ~3.7 MB per PDF.
        assert!(bytes.len() < 6_000_000, "got {} bytes", bytes.len());
        let text = String::from_utf8_lossy(&bytes);
        let pages = regex::Regex::new(r"/Type\s*/Page\b")
            .unwrap()
            .find_iter(&text)
            .count();
        assert_eq!(pages, 2, "two pages expected");
    }

    #[test]
    #[ignore = "diagnostics: prints parse/save timings and printpdf warnings"]
    fn font_timings() {
        let t0 = std::time::Instant::now();
        let font = parsed_font();
        eprintln!("parse: {:?}", t0.elapsed());
        let mut doc = PdfDocument::new("t");
        let id = doc.add_font(font);
        let ops = vec![
            Op::StartTextSection,
            Op::SetFont {
                font: PdfFontHandle::External(id.clone()),
                size: Pt(10.0),
            },
            Op::SetTextCursor {
                pos: Point {
                    x: Mm(10.0).into(),
                    y: Mm(200.0).into(),
                },
            },
            Op::ShowText {
                items: vec![TextItem::Text("飛行記録 JOURNEY".into())],
            },
            Op::EndTextSection,
        ];
        let page = PdfPage::new(Mm(210.0), Mm(297.0), ops);
        let mut warnings = Vec::new();
        let t1 = std::time::Instant::now();
        let bytes = doc.with_pages(vec![page]).save(
            &PdfSaveOptions {
                subset_fonts: true,
                ..Default::default()
            },
            &mut warnings,
        );
        eprintln!(
            "save: {:?} bytes={} warnings={}",
            t1.elapsed(),
            bytes.len(),
            warnings.len()
        );
        for w in warnings.iter().take(10) {
            eprintln!("warn: {w:?}");
        }
        std::fs::write(std::env::temp_dir().join("rgcs-font-timing.pdf"), &bytes).unwrap();
    }
}
