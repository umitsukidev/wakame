use memmap2::Mmap;
use napi::bindgen_prelude::{AsyncTask, Env, Error, Result, Task};
use napi_derive::napi;
use std::{fs::File, sync::Arc};
use sudachi::{
    analysis::{
        stateless_tokenizer::StatelessTokenizer,
        {Mode, Tokenize},
    },
    config::Config,
    dic::{
        dictionary::JapaneseDictionary,
        storage::{Storage, SudachiDicData},
    },
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum GroupingMode {
    None,
    ByParticle,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MorphemePart {
    Other,
    Particle,
    OpenBracket,
    CloseBracket,
    Punctuation,
    TrailingSymbol,
}

fn parse_grouping(grouping: Option<String>) -> Result<GroupingMode> {
    match grouping.as_deref() {
        None => Ok(GroupingMode::None),
        Some("助詞") => Ok(GroupingMode::ByParticle),
        Some(value) => Err(Error::from_reason(format!(
            "invalid Sudachi grouping \"{value}\"; expected \"助詞\"",
        ))),
    }
}

fn is_open_bracket_char(c: char) -> bool {
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

fn is_close_bracket_char(c: char) -> bool {
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

fn is_punctuation_char(c: char) -> bool {
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

fn is_trailing_symbol_char(c: char) -> bool {
    is_close_bracket_char(c)
        || is_punctuation_char(c)
        || matches!(
            c,
            'ー' | '―' | '‐' | '－' | '〜' | '～' | '・' | '々' | 'ゝ' | 'ヽ' | 'ゞ' | 'ヾ'
        )
}

fn classify_morpheme(part_of_speech: &[String], surface: &str) -> MorphemePart {
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
fn group_morphemes(morphemes: impl IntoIterator<Item = (String, MorphemePart)>) -> Vec<String> {
    let mut groups = Vec::new();
    let mut current = String::new();
    let mut last_was_open_bracket = false;
    let mut morphemes = morphemes.into_iter().peekable();

    while let Some((surface, part)) = morphemes.next() {
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
                            | MorphemePart::Particle
                    ))
                );
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
            }
            MorphemePart::Particle => {
                current.push_str(&surface);
                last_was_open_bracket = false;
                let next_is_particle = matches!(
                    morphemes.peek(),
                    Some((
                        _,
                        MorphemePart::Particle
                            | MorphemePart::CloseBracket
                            | MorphemePart::Punctuation
                            | MorphemePart::TrailingSymbol
                    ))
                );
                if !next_is_particle {
                    groups.push(std::mem::take(&mut current));
                }
            }
            MorphemePart::Other => {
                current.push_str(&surface);
                last_was_open_bracket = false;
            }
        }
    }

    if !current.is_empty() {
        groups.push(current);
    }

    groups
}

pub struct TokenizeTask {
    dictionary: Arc<JapaneseDictionary>,
    grouping: GroupingMode,
    mode: Mode,
    text: String,
}

#[napi]
impl Task for TokenizeTask {
    type Output = Vec<String>;
    type JsValue = Vec<String>;

    fn compute(&mut self) -> Result<Self::Output> {
        let tokenizer = StatelessTokenizer::new(Arc::clone(&self.dictionary));
        let morphemes = tokenizer
            .tokenize(&self.text, self.mode, false)
            .map_err(|error| Error::from_reason(error.to_string()))?;

        match self.grouping {
            GroupingMode::None => Ok(morphemes
                .iter()
                .map(|morpheme| morpheme.surface().to_string())
                .collect()),
            GroupingMode::ByParticle => Ok(group_morphemes(morphemes.iter().map(|morpheme| {
                let surface = morpheme.surface();
                let part = classify_morpheme(morpheme.part_of_speech(), &surface);
                (surface.to_string(), part)
            }))),
        }
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

#[napi]
pub struct SudachiTokenizer {
    dictionary: Arc<JapaneseDictionary>,
    grouping: GroupingMode,
    mode: Mode,
}

#[napi]
impl SudachiTokenizer {
    fn parse_split_mode(split_mode: Option<String>) -> Result<Mode> {
        match split_mode.as_deref().unwrap_or("C") {
            "A" => Ok(Mode::A),
            "B" => Ok(Mode::B),
            "C" => Ok(Mode::C),
            value => Err(Error::from_reason(format!(
                "invalid Sudachi split mode \"{value}\"; expected one of \"A\", \"B\", or \"C\"",
            ))),
        }
    }

    #[napi(constructor)]
    pub fn new(
        system_dictionary_path: String,
        split_mode: Option<String>,
        grouping: Option<String>,
    ) -> Result<Self> {
        let mode = Self::parse_split_mode(split_mode)?;
        let grouping = parse_grouping(grouping)?;
        let dictionary_file = File::open(&system_dictionary_path).map_err(|error| {
            Error::from_reason(format!(
                "failed to open system dictionary at {system_dictionary_path}: {error}",
            ))
        })?;
        let dictionary_map = unsafe { Mmap::map(&dictionary_file) }.map_err(|error| {
            Error::from_reason(format!(
                "failed to map system dictionary at {system_dictionary_path}: {error}",
            ))
        })?;
        let config = Config::minimal_at(".");
        let storage = SudachiDicData::new(Storage::File(dictionary_map));
        let dictionary =
            JapaneseDictionary::from_cfg_storage_with_embedded_chardef(&config, storage)
                .map_err(|error| Error::from_reason(error.to_string()))?;

        Ok(Self {
            dictionary: Arc::new(dictionary),
            grouping,
            mode,
        })
    }

    #[napi]
    pub fn tokenize(&self, text: String) -> AsyncTask<TokenizeTask> {
        AsyncTask::new(TokenizeTask {
            dictionary: Arc::clone(&self.dictionary),
            grouping: self.grouping,
            mode: self.mode,
            text,
        })
    }
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
        let groups = group_morphemes(input);

        assert_eq!(groups, ["私は", "猫です。"]);
        assert_eq!(groups.join(""), "私は猫です。");
    }

    #[test]
    fn keeps_consecutive_particles_in_one_group() {
        let groups = group_morphemes([
            morpheme("これ", MorphemePart::Other),
            morpheme("から", MorphemePart::Particle),
            morpheme("は", MorphemePart::Particle),
            morpheme("始まる", MorphemePart::Other),
        ]);

        assert_eq!(groups, ["これからは", "始まる"]);
    }

    #[test]
    fn sticks_opening_and_closing_brackets_and_punctuation() {
        // 「私は、猫です。」 -> ["「私は、", "猫です。」"]
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
        let groups1 = group_morphemes(input1);
        assert_eq!(groups1, ["「私は、", "猫です。」"]);
        assert_eq!(groups1.join(""), "「私は、猫です。」");

        // 彼（猫）が好き。 -> ["彼", "（猫）が", "好き。"]
        let input2 = [
            morpheme("彼", MorphemePart::Other),
            morpheme("（", MorphemePart::OpenBracket),
            morpheme("猫", MorphemePart::Other),
            morpheme("）", MorphemePart::CloseBracket),
            morpheme("が", MorphemePart::Particle),
            morpheme("好き", MorphemePart::Other),
            morpheme("。", MorphemePart::Punctuation),
        ];
        let groups2 = group_morphemes(input2);
        assert_eq!(groups2, ["彼", "（猫）が", "好き。"]);
        assert_eq!(groups2.join(""), "彼（猫）が好き。");

        // （これからは）始まる。 -> ["（これからは）", "始まる。"]
        let input3 = [
            morpheme("（", MorphemePart::OpenBracket),
            morpheme("これ", MorphemePart::Other),
            morpheme("から", MorphemePart::Particle),
            morpheme("は", MorphemePart::Particle),
            morpheme("）", MorphemePart::CloseBracket),
            morpheme("始まる", MorphemePart::Other),
            morpheme("。", MorphemePart::Punctuation),
        ];
        let groups3 = group_morphemes(input3);
        assert_eq!(groups3, ["（これからは）", "始まる。"]);
        assert_eq!(groups3.join(""), "（これからは）始まる。");

        // 私は「猫」が好き。 -> ["私は", "「猫」が", "好き。"]
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
        let groups4 = group_morphemes(input4);
        assert_eq!(groups4, ["私は", "「猫」が", "好き。"]);
        assert_eq!(groups4.join(""), "私は「猫」が好き。");

        // （「猫」） -> ["（「猫」）"]
        let input5 = [
            morpheme("（", MorphemePart::OpenBracket),
            morpheme("「", MorphemePart::OpenBracket),
            morpheme("猫", MorphemePart::Other),
            morpheme("」", MorphemePart::CloseBracket),
            morpheme("）", MorphemePart::CloseBracket),
        ];
        let groups5 = group_morphemes(input5);
        assert_eq!(groups5, ["（「猫」）"]);
        assert_eq!(groups5.join(""), "（「猫」）");
    }

    #[test]
    fn handles_trailing_symbols_and_exclamations() {
        // スーパー・マーケットに行こう〜！ -> ["スーパー・マーケットに", "行こう〜！"]
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
        let groups = group_morphemes(input);
        assert_eq!(groups, ["スーパー・マーケットに", "行こう〜！"]);
        assert_eq!(groups.join(""), "スーパー・マーケットに行こう〜！");
    }

    #[test]
    fn handles_empty_input() {
        let groups = group_morphemes(std::iter::empty());
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
        // Fallback checks with arbitrary/empty POS
        assert_eq!(classify_morpheme(&[], "（"), MorphemePart::OpenBracket);
        assert_eq!(classify_morpheme(&[], "）"), MorphemePart::CloseBracket);
        assert_eq!(classify_morpheme(&[], "！"), MorphemePart::Punctuation);
    }

    #[test]
    fn validates_grouping_mode() {
        assert_eq!(parse_grouping(None).unwrap(), GroupingMode::None);
        assert_eq!(
            parse_grouping(Some("助詞".to_owned())).unwrap(),
            GroupingMode::ByParticle
        );
        assert!(parse_grouping(Some("文節".to_owned())).is_err());
    }
}
