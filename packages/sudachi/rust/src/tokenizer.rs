use crate::{
    grouping::{parse_grouping, GroupingMode},
    task::TokenizeTask,
};
use memmap2::Mmap;
use napi::bindgen_prelude::{AsyncTask, Error, Result};
use napi_derive::napi;
use std::{fs::File, sync::Arc};
use sudachi::{
    analysis::Mode,
    config::Config,
    dic::{
        dictionary::JapaneseDictionary,
        storage::{Storage, SudachiDicData},
    },
};

#[napi]
pub struct SudachiTokenizer {
    dictionary: Arc<JapaneseDictionary>,
    grouping: GroupingMode,
    kinsoku: bool,
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
        kinsoku: Option<bool>,
    ) -> Result<Self> {
        let mode = Self::parse_split_mode(split_mode)?;
        let grouping = parse_grouping(grouping.as_deref()).map_err(Error::from_reason)?;
        let kinsoku = kinsoku.unwrap_or(false);
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
            kinsoku,
            mode,
        })
    }

    #[napi]
    pub fn tokenize(&self, text: String) -> AsyncTask<TokenizeTask> {
        AsyncTask::new(TokenizeTask {
            dictionary: Arc::clone(&self.dictionary),
            grouping: self.grouping,
            kinsoku: self.kinsoku,
            mode: self.mode,
            text,
        })
    }
}
