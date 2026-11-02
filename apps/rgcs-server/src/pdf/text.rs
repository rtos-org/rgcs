//! Text measurement and wrapping for the forms. Widths are approximated per character class
//! (CJK = 1 em, ASCII / half-width = 0.5 em), which is deterministic and close enough for
//! the fixed-width table cells of the MLIT forms.

/// One em in millimetres for a font size in points.
pub fn em_mm(size_pt: f32) -> f32 {
    size_pt * 25.4 / 72.0
}

/// Advance of one character in em: half for ASCII and half-width katakana, full otherwise.
pub fn char_em(c: char) -> f32 {
    if c.is_ascii() || ('\u{FF61}'..='\u{FF9F}').contains(&c) {
        0.5
    } else {
        1.0
    }
}

pub fn width_mm(text: &str, size_pt: f32) -> f32 {
    text.chars().map(char_em).sum::<f32>() * em_mm(size_pt)
}

/// Breaks `text` into lines no wider than `width_mm`; explicit newlines are honoured and an
/// empty string yields one empty line. A character wider than the cell still gets its own line.
pub fn wrap(text: &str, width_mm: f32, size_pt: f32) -> Vec<String> {
    let max_em = (width_mm / em_mm(size_pt)).max(0.0) + 1e-4;
    let mut lines = Vec::new();
    for paragraph in text.split('\n') {
        let mut line = String::new();
        let mut used = 0.0f32;
        for c in paragraph.chars() {
            let w = char_em(c);
            if used + w > max_em && !line.is_empty() {
                lines.push(std::mem::take(&mut line));
                used = 0.0;
            }
            line.push(c);
            used += w;
        }
        lines.push(line);
    }
    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn width_counts_cjk_as_one_em_and_ascii_as_half() {
        assert!((width_mm("ab", 10.0) - em_mm(10.0)).abs() < 1e-6);
        assert!((width_mm("日本", 10.0) - 2.0 * em_mm(10.0)).abs() < 1e-6);
        assert!((em_mm(72.0) - 25.4).abs() < 1e-6);
    }

    #[test]
    fn wrap_breaks_at_width_and_keeps_newlines() {
        assert_eq!(
            wrap("日本語日本語", 2.5 * em_mm(8.0), 8.0),
            vec!["日本", "語日", "本語"]
        );
        assert_eq!(wrap("a\nb", 100.0, 8.0), vec!["a", "b"]);
        assert_eq!(wrap("", 100.0, 8.0), vec![""]);
        assert_eq!(wrap("abcdef", 1.5 * em_mm(8.0), 8.0), vec!["abc", "def"]);
    }
}
