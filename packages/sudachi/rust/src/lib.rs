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
    Symbol,
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

fn classify_part_of_speech(part_of_speech: &[String]) -> MorphemePart {
    match part_of_speech.first().map(String::as_str) {
        Some("助詞") => MorphemePart::Particle,
        Some("記号" | "補助記号") => MorphemePart::Symbol,
        _ => MorphemePart::Other,
    }
}

/// Apply the provisional POS-based grouping used for line-wrap units.
/// This deliberately does not attempt syntactic or dependency analysis.
fn group_morphemes(morphemes: impl IntoIterator<Item = (String, MorphemePart)>) -> Vec<String> {
    let mut groups = Vec::new();
    let mut current = String::new();
    let mut morphemes = morphemes.into_iter().peekable();

    while let Some((surface, part)) = morphemes.next() {
        match part {
            MorphemePart::Other => current.push_str(&surface),
            MorphemePart::Particle => {
                current.push_str(&surface);
                let next_is_particle = matches!(
                    morphemes.peek(),
                    Some((_, next)) if *next == MorphemePart::Particle
                );
                if !next_is_particle {
                    groups.push(std::mem::take(&mut current));
                }
            }
            MorphemePart::Symbol => {
                if !current.is_empty() {
                    groups.push(std::mem::take(&mut current));
                }
                if !surface.is_empty() {
                    groups.push(surface);
                }
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
                (
                    morpheme.surface().to_string(),
                    classify_part_of_speech(morpheme.part_of_speech()),
                )
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
    use super::{
        classify_part_of_speech, group_morphemes, parse_grouping, GroupingMode, MorphemePart,
    };

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
            morpheme("。", MorphemePart::Symbol),
        ];
        let groups = group_morphemes(input);

        assert_eq!(groups, ["私は", "猫です", "。"]);
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
    fn keeps_punctuation_and_symbols_as_their_own_groups() {
        let groups = group_morphemes([
            morpheme("（", MorphemePart::Symbol),
            morpheme("猫", MorphemePart::Other),
            morpheme("）", MorphemePart::Symbol),
            morpheme("。", MorphemePart::Symbol),
        ]);

        assert_eq!(groups, ["（", "猫", "）", "。"]);
        assert_eq!(groups.join(""), "（猫）。");
    }

    #[test]
    fn handles_empty_input() {
        let groups = group_morphemes(std::iter::empty());

        assert!(groups.is_empty());
    }

    #[test]
    fn recognizes_particle_and_symbol_pos() {
        assert_eq!(
            classify_part_of_speech(&["助詞".to_owned()]),
            MorphemePart::Particle
        );
        assert_eq!(
            classify_part_of_speech(&["記号".to_owned()]),
            MorphemePart::Symbol
        );
        assert_eq!(
            classify_part_of_speech(&["補助記号".to_owned()]),
            MorphemePart::Symbol
        );
        assert_eq!(
            classify_part_of_speech(&["名詞".to_owned()]),
            MorphemePart::Other
        );
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
