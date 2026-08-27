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

pub struct TokenizeTask {
    dictionary: Arc<JapaneseDictionary>,
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

        Ok(morphemes
            .iter()
            .map(|morpheme| morpheme.surface().to_string())
            .collect())
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

#[napi]
pub struct SudachiTokenizer {
    dictionary: Arc<JapaneseDictionary>,
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
    pub fn new(system_dictionary_path: String, split_mode: Option<String>) -> Result<Self> {
        let mode = Self::parse_split_mode(split_mode)?;
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
            mode,
        })
    }

    #[napi]
    pub fn tokenize(&self, text: String) -> AsyncTask<TokenizeTask> {
        AsyncTask::new(TokenizeTask {
            dictionary: Arc::clone(&self.dictionary),
            mode: self.mode,
            text,
        })
    }
}
