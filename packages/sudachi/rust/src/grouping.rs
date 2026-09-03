#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GroupingMode {
    None,
    Particle,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MorphemePart {
    Other,
    Particle,
    OpenBracket,
    CloseBracket,
    Punctuation,
    TrailingSymbol,
}

pub fn parse_grouping(grouping: Option<&str>) -> Result<GroupingMode, String> {
    match grouping {
        None => Ok(GroupingMode::None),
        Some("particle" | "助詞") => Ok(GroupingMode::Particle),
        Some(value) => Err(format!(
            "invalid Sudachi grouping \"{value}\"; expected \"particle\"",
        )),
    }
}

pub fn is_open_bracket_char(c: char) -> bool {
    matches!(
        c,
        '(' | '['
            | '{'
            | '<'
            | '（'
            | '［'
            | '｛'
            | '〈'
            | '《'
            | '「'
            | '『'
            | '【'
            | '〔'
            | '〖'
            | '〘'
            | '〚'
            | '‘'
            | '“'
            | '«'
            | '‹'
    )
}

pub fn is_close_bracket_char(c: char) -> bool {
    matches!(
        c,
        ')' | ']'
            | '}'
            | '>'
            | '）'
            | '］'
            | '｝'
            | '〉'
            | '》'
            | '」'
            | '』'
            | '】'
            | '〕'
            | '〗'
            | '〙'
            | '〚'
            | '’'
            | '”'
            | '»'
            | '›'
    )
}

pub fn is_punctuation_char(c: char) -> bool {
    matches!(
        c,
        '、' | '。'
            | ','
            | '.'
            | '，'
            | '．'
            | '！'
            | '？'
            | '!'
            | '?'
            | '…'
            | '‥'
            | '：'
            | '；'
            | ':'
            | ';'
    )
}

pub fn is_trailing_symbol_char(c: char) -> bool {
    is_close_bracket_char(c)
        || is_punctuation_char(c)
        || matches!(
            c,
            'ー' | '―' | '‐' | '－' | '〜' | '～' | '・' | '々' | 'ゝ' | 'ヽ' | 'ゞ' | 'ヾ'
        )
}

pub fn classify_morpheme(part_of_speech: &[String], surface: &str) -> MorphemePart {
    let pos0 = part_of_speech.first().map(String::as_str);
    let pos1 = part_of_speech.get(1).map(String::as_str);

    if pos0 == Some("助詞") {
        return MorphemePart::Particle;
    }

    if pos0 == Some("補助記号") {
        match pos1 {
            Some("括弧開") => return MorphemePart::OpenBracket,
            Some("括弧閉") => return MorphemePart::CloseBracket,
            Some("句点" | "読点") => return MorphemePart::Punctuation,
            _ => {}
        }
    }

    if !surface.is_empty() {
        if surface.chars().all(is_open_bracket_char) {
            return MorphemePart::OpenBracket;
        }
        if surface.chars().all(is_close_bracket_char) {
            return MorphemePart::CloseBracket;
        }
        if surface.chars().all(is_punctuation_char) {
            return MorphemePart::Punctuation;
        }
        if surface.chars().all(is_trailing_symbol_char) {
            return MorphemePart::TrailingSymbol;
        }
    }

    MorphemePart::Other
}

/// Apply the provisional POS-based grouping used for line-wrap units.
/// Follows Japanese line-breaking rules (JIS X 4051):
/// - Opening brackets stick to following morphemes (never split after opening brackets)
/// - Closing brackets, punctuation, and trailing symbols stick to preceding morphemes (never split before them)
/// - Particles attach to preceding words, but defer splitting if followed by closing brackets, punctuation, or further particles
pub fn group_morphemes(
    morphemes: impl IntoIterator<Item = (String, MorphemePart)>,
    grouping: GroupingMode,
    kinsoku: bool,
) -> Vec<String> {
    let mut groups = Vec::new();
    let mut current = String::new();
    let mut last_was_open_bracket = false;
    let mut morphemes = morphemes.into_iter().peekable();

    while let Some((surface, part)) = morphemes.next() {
        if !kinsoku {
            match part {
                MorphemePart::Other => {
                    current.push_str(&surface);
                    if grouping == GroupingMode::None {
                        groups.push(std::mem::take(&mut current));
                    }
                }
                MorphemePart::Particle => {
                    current.push_str(&surface);
                    let next_is_particle =
                        matches!(morphemes.peek(), Some((_, MorphemePart::Particle)));
                    if grouping == GroupingMode::None || !next_is_particle {
                        groups.push(std::mem::take(&mut current));
                    }
                }
                MorphemePart::OpenBracket
                | MorphemePart::CloseBracket
                | MorphemePart::Punctuation
                | MorphemePart::TrailingSymbol => {
                    if !current.is_empty() {
                        groups.push(std::mem::take(&mut current));
                    }
                    if !surface.is_empty() {
                        groups.push(surface);
                    }
                }
            }
            continue;
        }

        match part {
            MorphemePart::OpenBracket => {
                if !current.is_empty() && !last_was_open_bracket {
                    groups.push(std::mem::take(&mut current));
                }
                current.push_str(&surface);
                last_was_open_bracket = true;
            }
            MorphemePart::CloseBracket => {
                current.push_str(&surface);
                last_was_open_bracket = false;
                let next_joins_to_this = matches!(
                    morphemes.peek(),
                    Some((
                        _,
                        MorphemePart::CloseBracket
                            | MorphemePart::Punctuation
                            | MorphemePart::TrailingSymbol
                    ))
                ) || (grouping == GroupingMode::Particle
                    && matches!(morphemes.peek(), Some((_, MorphemePart::Particle))));
                if !next_joins_to_this {
                    groups.push(std::mem::take(&mut current));
                }
            }
            MorphemePart::Punctuation => {
                current.push_str(&surface);
                last_was_open_bracket = false;
                let next_joins_to_this = matches!(
                    morphemes.peek(),
                    Some((
                        _,
                        MorphemePart::CloseBracket
                            | MorphemePart::Punctuation
                            | MorphemePart::TrailingSymbol
                    ))
                );
                if !next_joins_to_this {
                    groups.push(std::mem::take(&mut current));
                }
            }
            MorphemePart::TrailingSymbol => {
                current.push_str(&surface);
                last_was_open_bracket = false;
                let next_joins_to_this = matches!(
                    morphemes.peek(),
                    Some((
                        _,
                        MorphemePart::CloseBracket
                            | MorphemePart::Punctuation
                            | MorphemePart::TrailingSymbol
                    ))
                );
                if !next_joins_to_this && grouping == GroupingMode::None {
                    groups.push(std::mem::take(&mut current));
                }
            }
            MorphemePart::Particle => {
                current.push_str(&surface);
                last_was_open_bracket = false;
                let next_joins = matches!(
                    morphemes.peek(),
                    Some((
                        _,
                        MorphemePart::CloseBracket
                            | MorphemePart::Punctuation
                            | MorphemePart::TrailingSymbol
                    ))
                ) || (grouping == GroupingMode::Particle
                    && matches!(morphemes.peek(), Some((_, MorphemePart::Particle))));
                if !next_joins {
                    groups.push(std::mem::take(&mut current));
                }
            }
            MorphemePart::Other => {
                current.push_str(&surface);
                last_was_open_bracket = false;
                let next_joins = matches!(
                    morphemes.peek(),
                    Some((
                        _,
                        MorphemePart::CloseBracket
                            | MorphemePart::Punctuation
                            | MorphemePart::TrailingSymbol
                    ))
                );
                if !next_joins && grouping == GroupingMode::None {
                    groups.push(std::mem::take(&mut current));
                }
            }
        }
    }

    if !current.is_empty() {
        groups.push(current);
    }

    groups
}

#[cfg(test)]
mod tests {
    use super::{classify_morpheme, group_morphemes, parse_grouping, GroupingMode, MorphemePart};

    fn morpheme(surface: &str, part: MorphemePart) -> (String, MorphemePart) {
        (surface.to_owned(), part)
    }

    #[test]
    fn groups_after_a_particle_and_reconstructs_input() {
        let input = [
            morpheme("私", MorphemePart::Other),
            morpheme("は", MorphemePart::Particle),
            morpheme("猫", MorphemePart::Other),
            morpheme("です", MorphemePart::Other),
            morpheme("。", MorphemePart::Punctuation),
        ];
        let groups = group_morphemes(input, GroupingMode::Particle, true);

        assert_eq!(groups, ["私は", "猫です。"]);
        assert_eq!(groups.join(""), "私は猫です。");
    }

    #[test]
    fn keeps_consecutive_particles_in_one_group() {
        let groups = group_morphemes(
            [
                morpheme("これ", MorphemePart::Other),
                morpheme("から", MorphemePart::Particle),
                morpheme("は", MorphemePart::Particle),
                morpheme("始まる", MorphemePart::Other),
            ],
            GroupingMode::Particle,
            true,
        );

        assert_eq!(groups, ["これからは", "始まる"]);
    }

    #[test]
    fn applies_kinsoku_without_grouping() {
        let input = [
            morpheme("「", MorphemePart::OpenBracket),
            morpheme("私", MorphemePart::Other),
            morpheme("は", MorphemePart::Particle),
            morpheme("、", MorphemePart::Punctuation),
            morpheme("猫", MorphemePart::Other),
            morpheme("です", MorphemePart::Other),
            morpheme("。", MorphemePart::Punctuation),
            morpheme("」", MorphemePart::CloseBracket),
        ];
        let groups = group_morphemes(input, GroupingMode::None, true);
        assert_eq!(groups, ["「私", "は、", "猫", "です。」"]);
        assert_eq!(groups.join(""), "「私は、猫です。」");
    }

    #[test]
    fn separates_symbols_when_kinsoku_is_disabled() {
        let input = [
            morpheme("「", MorphemePart::OpenBracket),
            morpheme("私", MorphemePart::Other),
            morpheme("は", MorphemePart::Particle),
            morpheme("、", MorphemePart::Punctuation),
        ];
        let groups_particle = group_morphemes(input.clone(), GroupingMode::Particle, false);
        assert_eq!(groups_particle, ["「", "私は", "、"]);

        let groups_none = group_morphemes(input, GroupingMode::None, false);
        assert_eq!(groups_none, ["「", "私", "は", "、"]);
    }

    #[test]
    fn sticks_opening_and_closing_brackets_and_punctuation() {
        let input1 = [
            morpheme("「", MorphemePart::OpenBracket),
            morpheme("私", MorphemePart::Other),
            morpheme("は", MorphemePart::Particle),
            morpheme("、", MorphemePart::Punctuation),
            morpheme("猫", MorphemePart::Other),
            morpheme("です", MorphemePart::Other),
            morpheme("。", MorphemePart::Punctuation),
            morpheme("」", MorphemePart::CloseBracket),
        ];
        let groups1 = group_morphemes(input1, GroupingMode::Particle, true);
        assert_eq!(groups1, ["「私は、", "猫です。」"]);
        assert_eq!(groups1.join(""), "「私は、猫です。」");

        let input2 = [
            morpheme("彼", MorphemePart::Other),
            morpheme("（", MorphemePart::OpenBracket),
            morpheme("猫", MorphemePart::Other),
            morpheme("）", MorphemePart::CloseBracket),
            morpheme("が", MorphemePart::Particle),
            morpheme("好き", MorphemePart::Other),
            morpheme("。", MorphemePart::Punctuation),
        ];
        let groups2 = group_morphemes(input2, GroupingMode::Particle, true);
        assert_eq!(groups2, ["彼", "（猫）が", "好き。"]);
        assert_eq!(groups2.join(""), "彼（猫）が好き。");

        let input3 = [
            morpheme("（", MorphemePart::OpenBracket),
            morpheme("これ", MorphemePart::Other),
            morpheme("から", MorphemePart::Particle),
            morpheme("は", MorphemePart::Particle),
            morpheme("）", MorphemePart::CloseBracket),
            morpheme("始まる", MorphemePart::Other),
            morpheme("。", MorphemePart::Punctuation),
        ];
        let groups3 = group_morphemes(input3, GroupingMode::Particle, true);
        assert_eq!(groups3, ["（これからは）", "始まる。"]);
        assert_eq!(groups3.join(""), "（これからは）始まる。");

        let input4 = [
            morpheme("私", MorphemePart::Other),
            morpheme("は", MorphemePart::Particle),
            morpheme("「", MorphemePart::OpenBracket),
            morpheme("猫", MorphemePart::Other),
            morpheme("」", MorphemePart::CloseBracket),
            morpheme("が", MorphemePart::Particle),
            morpheme("好き", MorphemePart::Other),
            morpheme("。", MorphemePart::Punctuation),
        ];
        let groups4 = group_morphemes(input4, GroupingMode::Particle, true);
        assert_eq!(groups4, ["私は", "「猫」が", "好き。"]);
        assert_eq!(groups4.join(""), "私は「猫」が好き。");

        let input5 = [
            morpheme("（", MorphemePart::OpenBracket),
            morpheme("「", MorphemePart::OpenBracket),
            morpheme("猫", MorphemePart::Other),
            morpheme("」", MorphemePart::CloseBracket),
            morpheme("）", MorphemePart::CloseBracket),
        ];
        let groups5 = group_morphemes(input5, GroupingMode::Particle, true);
        assert_eq!(groups5, ["（「猫」）"]);
        assert_eq!(groups5.join(""), "（「猫」）");
    }

    #[test]
    fn handles_trailing_symbols_and_exclamations() {
        let input = [
            morpheme("スーパー", MorphemePart::Other),
            morpheme("・", MorphemePart::TrailingSymbol),
            morpheme("マーケット", MorphemePart::Other),
            morpheme("に", MorphemePart::Particle),
            morpheme("行こ", MorphemePart::Other),
            morpheme("う", MorphemePart::Other),
            morpheme("〜", MorphemePart::TrailingSymbol),
            morpheme("！", MorphemePart::Punctuation),
        ];
        let groups = group_morphemes(input, GroupingMode::Particle, true);
        assert_eq!(groups, ["スーパー・マーケットに", "行こう〜！"]);
        assert_eq!(groups.join(""), "スーパー・マーケットに行こう〜！");
    }

    #[test]
    fn handles_empty_input() {
        let groups = group_morphemes(std::iter::empty(), GroupingMode::Particle, true);
        assert!(groups.is_empty());
    }

    #[test]
    fn recognizes_part_of_speech_and_symbols() {
        assert_eq!(
            classify_morpheme(&["助詞".to_owned()], "は"),
            MorphemePart::Particle
        );
        assert_eq!(
            classify_morpheme(&["補助記号".to_owned(), "括弧開".to_owned()], "「"),
            MorphemePart::OpenBracket
        );
        assert_eq!(
            classify_morpheme(&["補助記号".to_owned(), "括弧閉".to_owned()], "」"),
            MorphemePart::CloseBracket
        );
        assert_eq!(
            classify_morpheme(&["補助記号".to_owned(), "句点".to_owned()], "。"),
            MorphemePart::Punctuation
        );
        assert_eq!(
            classify_morpheme(&["補助記号".to_owned(), "読点".to_owned()], "、"),
            MorphemePart::Punctuation
        );
        assert_eq!(
            classify_morpheme(&["記号".to_owned(), "一般".to_owned()], "〜"),
            MorphemePart::TrailingSymbol
        );
        assert_eq!(
            classify_morpheme(&["名詞".to_owned()], "猫"),
            MorphemePart::Other
        );
        assert_eq!(classify_morpheme(&[], "（"), MorphemePart::OpenBracket);
        assert_eq!(classify_morpheme(&[], "）"), MorphemePart::CloseBracket);
        assert_eq!(classify_morpheme(&[], "！"), MorphemePart::Punctuation);
    }

    #[test]
    fn validates_grouping_mode() {
        assert_eq!(parse_grouping(None).unwrap(), GroupingMode::None);
        assert_eq!(
            parse_grouping(Some("particle")).unwrap(),
            GroupingMode::Particle
        );
        assert_eq!(
            parse_grouping(Some("助詞")).unwrap(),
            GroupingMode::Particle
        );
        assert!(parse_grouping(Some("文節")).is_err());
    }
}
