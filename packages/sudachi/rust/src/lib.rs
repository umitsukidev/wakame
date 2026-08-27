use std::fs::File;
use std::sync::Arc;

use memmap2::Mmap;
use napi::bindgen_prelude::{AsyncTask, Env, Error, Result, Task};
use napi_derive::napi;
use sudachi::analysis::stateless_tokenizer::StatelessTokenizer;
use sudachi::analysis::{Mode, Tokenize};
use sudachi::config::Config;
use sudachi::dic::dictionary::JapaneseDictionary;
use sudachi::dic::storage::{Storage, SudachiDicData};

pub struct TokenizeTask {
    dictionary: Arc<JapaneseDictionary>,
    text: String,
}

#[napi]
impl Task for TokenizeTask {
    type Output = Vec<String>;
    type JsValue = Vec<String>;

    fn compute(&mut self) -> Result<Self::Output> {
        let tokenizer = StatelessTokenizer::new(Arc::clone(&self.dictionary));
        let morphemes = tokenizer
            .tokenize(&self.text, Mode::C, false)
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
}

#[napi]
impl SudachiTokenizer {
    #[napi(constructor)]
    pub fn new(system_dictionary_path: String) -> Result<Self> {
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
        })
    }

    #[napi]
    pub fn tokenize(&self, text: String) -> AsyncTask<TokenizeTask> {
        AsyncTask::new(TokenizeTask {
            dictionary: Arc::clone(&self.dictionary),
            text,
        })
    }
}
