#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GroupingMode {
    None,
    Particle,
    Bunsetsu,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MorphemePart {
    Independent,
    Dependent,
    Prefix,
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
        Some("bunsetsu" | "文節") => Ok(GroupingMode::Bunsetsu),
        Some(value) => Err(format!(
            "invalid Sudachi grouping \"{value}\"; expected \"particle\" or \"bunsetsu\"",
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

    if pos0 == Some("助動詞") || pos0 == Some("接尾辞") {
        return MorphemePart::Dependent;
    }

    if pos0 == Some("接頭辞") {
        return MorphemePart::Prefix;
    }

    if (pos0 == Some("動詞") || pos0 == Some("形容詞")) && pos1 == Some("非自立可能") {
        return MorphemePart::Dependent;
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

    MorphemePart::Independent
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
    let mut last_was_prefix = false;
    let mut morphemes = morphemes.into_iter().peekable();

    while let Some((surface, part)) = morphemes.next() {
        if !kinsoku {
            match part {
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
                    last_was_prefix = false;
                }
                MorphemePart::Prefix => {
                    if !current.is_empty() && grouping != GroupingMode::None {
                        groups.push(std::mem::take(&mut current));
                    }
                    current.push_str(&surface);
                    last_was_prefix = true;
                    if grouping == GroupingMode::None {
                        groups.push(std::mem::take(&mut current));
                    }
                }
                MorphemePart::Independent => {
                    if grouping == GroupingMode::Bunsetsu && !current.is_empty() && !last_was_prefix
                    {
                        groups.push(std::mem::take(&mut current));
                    }
                    current.push_str(&surface);
                    last_was_prefix = false;
                    if grouping == GroupingMode::None {
                        groups.push(std::mem::take(&mut current));
                    }
                }
                MorphemePart::Dependent => {
                    current.push_str(&surface);
                    last_was_prefix = false;
                    if grouping == GroupingMode::None {
                        groups.push(std::mem::take(&mut current));
                    }
                }
                MorphemePart::Particle => {
                    current.push_str(&surface);
                    last_was_prefix = false;
                    let next_is_particle =
                        matches!(morphemes.peek(), Some((_, MorphemePart::Particle)));
                    if grouping == GroupingMode::None
                        || (grouping == GroupingMode::Particle && !next_is_particle)
                    {
                        groups.push(std::mem::take(&mut current));
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
                last_was_prefix = false;
            }
            MorphemePart::CloseBracket => {
                current.push_str(&surface);
                last_was_open_bracket = false;
                last_was_prefix = false;
                let next_joins_to_this = matches!(
                    morphemes.peek(),
                    Some((
                        _,
                        MorphemePart::CloseBracket
                            | MorphemePart::Punctuation
                            | MorphemePart::TrailingSymbol
                    ))
                ) || (grouping != GroupingMode::None
                    && matches!(
                        morphemes.peek(),
                        Some((_, MorphemePart::Particle | MorphemePart::Dependent))
                    ));
                if !next_joins_to_this {
                    groups.push(std::mem::take(&mut current));
                }
            }
            MorphemePart::Punctuation => {
                current.push_str(&surface);
                last_was_open_bracket = false;
                last_was_prefix = false;
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
                last_was_prefix = false;
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
            MorphemePart::Prefix => {
                if !current.is_empty() && !last_was_open_bracket && grouping != GroupingMode::None {
                    groups.push(std::mem::take(&mut current));
                }
                current.push_str(&surface);
                last_was_open_bracket = false;
                last_was_prefix = true;
                if grouping == GroupingMode::None {
                    let next_joins = matches!(
                        morphemes.peek(),
                        Some((
                            _,
                            MorphemePart::CloseBracket
                                | MorphemePart::Punctuation
                                | MorphemePart::TrailingSymbol
                        ))
                    );
                    if !next_joins {
                        groups.push(std::mem::take(&mut current));
                    }
                }
            }
            MorphemePart::Independent => {
                if grouping == GroupingMode::Bunsetsu
                    && !current.is_empty()
                    && !last_was_open_bracket
                    && !last_was_prefix
                {
                    groups.push(std::mem::take(&mut current));
                }
                current.push_str(&surface);
                last_was_open_bracket = false;
                last_was_prefix = false;
                if grouping == GroupingMode::None {
                    let next_joins = matches!(
                        morphemes.peek(),
                        Some((
                            _,
                            MorphemePart::CloseBracket
                                | MorphemePart::Punctuation
                                | MorphemePart::TrailingSymbol
                        ))
                    );
                    if !next_joins {
                        groups.push(std::mem::take(&mut current));
                    }
                }
            }
            MorphemePart::Dependent => {
                current.push_str(&surface);
                last_was_open_bracket = false;
                last_was_prefix = false;
                if grouping == GroupingMode::None {
                    let next_joins = matches!(
                        morphemes.peek(),
                        Some((
                            _,
                            MorphemePart::CloseBracket
                                | MorphemePart::Punctuation
                                | MorphemePart::TrailingSymbol
                        ))
                    );
                    if !next_joins {
                        groups.push(std::mem::take(&mut current));
                    }
                }
            }
            MorphemePart::Particle => {
                current.push_str(&surface);
                last_was_open_bracket = false;
                last_was_prefix = false;
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
                    if grouping == GroupingMode::None || grouping == GroupingMode::Particle {
                        groups.push(std::mem::take(&mut current));
                    }
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
    fn groups_by_bunsetsu_with_independent_and_dependent_words() {
        // 「私は東京の大学に通っています。」
        // -> ["「私は", "東京の", "大学に", "通っています。」"]
        let input = [
            morpheme("「", MorphemePart::OpenBracket),
            morpheme("私", MorphemePart::Independent),
            morpheme("は", MorphemePart::Particle),
            morpheme("東京", MorphemePart::Independent),
            morpheme("の", MorphemePart::Particle),
            morpheme("大学", MorphemePart::Independent),
            morpheme("に", MorphemePart::Particle),
            morpheme("通っ", MorphemePart::Independent),
            morpheme("て", MorphemePart::Particle),
            morpheme("い", MorphemePart::Dependent),
            morpheme("ます", MorphemePart::Dependent),
            morpheme("。", MorphemePart::Punctuation),
            morpheme("」", MorphemePart::CloseBracket),
        ];
        let groups = group_morphemes(input, GroupingMode::Bunsetsu, true);
        assert_eq!(groups, ["「私は", "東京の", "大学に", "通っています。」"]);
        assert_eq!(groups.join(""), "「私は東京の大学に通っています。」");
    }

    #[test]
    fn handles_prefix_and_suffix_in_bunsetsu() {
        // 「お茶を飲みました。」 -> ["「お茶を", "飲みました。」"]
        let input1 = [
            morpheme("「", MorphemePart::OpenBracket),
            morpheme("お", MorphemePart::Prefix),
            morpheme("茶", MorphemePart::Independent),
            morpheme("を", MorphemePart::Particle),
            morpheme("飲み", MorphemePart::Independent),
            morpheme("まし", MorphemePart::Dependent),
            morpheme("た", MorphemePart::Dependent),
            morpheme("。", MorphemePart::Punctuation),
            morpheme("」", MorphemePart::CloseBracket),
        ];
        let groups1 = group_morphemes(input1, GroupingMode::Bunsetsu, true);
        assert_eq!(groups1, ["「お茶を", "飲みました。」"]);
        assert_eq!(groups1.join(""), "「お茶を飲みました。」");

        // 「子供達が走る。」 -> ["「子供達が", "走る。」"]
        let input2 = [
            morpheme("「", MorphemePart::OpenBracket),
            morpheme("子供", MorphemePart::Independent),
            morpheme("達", MorphemePart::Dependent),
            morpheme("が", MorphemePart::Particle),
            morpheme("走る", MorphemePart::Independent),
            morpheme("。", MorphemePart::Punctuation),
            morpheme("」", MorphemePart::CloseBracket),
        ];
        let groups2 = group_morphemes(input2, GroupingMode::Bunsetsu, true);
        assert_eq!(groups2, ["「子供達が", "走る。」"]);
        assert_eq!(groups2.join(""), "「子供達が走る。」");
    }

    #[test]
    fn groups_after_a_particle_and_reconstructs_input() {
        let input = [
            morpheme("私", MorphemePart::Independent),
            morpheme("は", MorphemePart::Particle),
            morpheme("猫", MorphemePart::Independent),
            morpheme("です", MorphemePart::Dependent),
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
                morpheme("これ", MorphemePart::Independent),
                morpheme("から", MorphemePart::Particle),
                morpheme("は", MorphemePart::Particle),
                morpheme("始まる", MorphemePart::Independent),
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
            morpheme("私", MorphemePart::Independent),
            morpheme("は", MorphemePart::Particle),
            morpheme("、", MorphemePart::Punctuation),
            morpheme("猫", MorphemePart::Independent),
            morpheme("です", MorphemePart::Dependent),
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
            morpheme("私", MorphemePart::Independent),
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
            morpheme("私", MorphemePart::Independent),
            morpheme("は", MorphemePart::Particle),
            morpheme("、", MorphemePart::Punctuation),
            morpheme("猫", MorphemePart::Independent),
            morpheme("です", MorphemePart::Dependent),
            morpheme("。", MorphemePart::Punctuation),
            morpheme("」", MorphemePart::CloseBracket),
        ];
        let groups1 = group_morphemes(input1, GroupingMode::Particle, true);
        assert_eq!(groups1, ["「私は、", "猫です。」"]);
        assert_eq!(groups1.join(""), "「私は、猫です。」");

        let input2 = [
            morpheme("彼", MorphemePart::Independent),
            morpheme("（", MorphemePart::OpenBracket),
            morpheme("猫", MorphemePart::Independent),
            morpheme("）", MorphemePart::CloseBracket),
            morpheme("が", MorphemePart::Particle),
            morpheme("好き", MorphemePart::Independent),
            morpheme("。", MorphemePart::Punctuation),
        ];
        let groups2 = group_morphemes(input2, GroupingMode::Particle, true);
        assert_eq!(groups2, ["彼", "（猫）が", "好き。"]);
        assert_eq!(groups2.join(""), "彼（猫）が好き。");

        let input3 = [
            morpheme("（", MorphemePart::OpenBracket),
            morpheme("これ", MorphemePart::Independent),
            morpheme("から", MorphemePart::Particle),
            morpheme("は", MorphemePart::Particle),
            morpheme("）", MorphemePart::CloseBracket),
            morpheme("始まる", MorphemePart::Independent),
            morpheme("。", MorphemePart::Punctuation),
        ];
        let groups3 = group_morphemes(input3, GroupingMode::Particle, true);
        assert_eq!(groups3, ["（これからは）", "始まる。"]);
        assert_eq!(groups3.join(""), "（これからは）始まる。");

        let input4 = [
            morpheme("私", MorphemePart::Independent),
            morpheme("は", MorphemePart::Particle),
            morpheme("「", MorphemePart::OpenBracket),
            morpheme("猫", MorphemePart::Independent),
            morpheme("」", MorphemePart::CloseBracket),
            morpheme("が", MorphemePart::Particle),
            morpheme("好き", MorphemePart::Independent),
            morpheme("。", MorphemePart::Punctuation),
        ];
        let groups4 = group_morphemes(input4, GroupingMode::Particle, true);
        assert_eq!(groups4, ["私は", "「猫」が", "好き。"]);
        assert_eq!(groups4.join(""), "私は「猫」が好き。");

        let input5 = [
            morpheme("（", MorphemePart::OpenBracket),
            morpheme("「", MorphemePart::OpenBracket),
            morpheme("猫", MorphemePart::Independent),
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
            morpheme("スーパー", MorphemePart::Independent),
            morpheme("・", MorphemePart::TrailingSymbol),
            morpheme("マーケット", MorphemePart::Independent),
            morpheme("に", MorphemePart::Particle),
            morpheme("行こ", MorphemePart::Independent),
            morpheme("う", MorphemePart::Dependent),
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
            classify_morpheme(&["助動詞".to_owned()], "です"),
            MorphemePart::Dependent
        );
        assert_eq!(
            classify_morpheme(&["接尾辞".to_owned()], "達"),
            MorphemePart::Dependent
        );
        assert_eq!(
            classify_morpheme(&["接頭辞".to_owned()], "お"),
            MorphemePart::Prefix
        );
        assert_eq!(
            classify_morpheme(&["動詞".to_owned(), "非自立可能".to_owned()], "いる"),
            MorphemePart::Dependent
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
            MorphemePart::Independent
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
        assert_eq!(
            parse_grouping(Some("bunsetsu")).unwrap(),
            GroupingMode::Bunsetsu
        );
        assert_eq!(
            parse_grouping(Some("文節")).unwrap(),
            GroupingMode::Bunsetsu
        );
        assert!(parse_grouping(Some("unknown")).is_err());
    }
}
