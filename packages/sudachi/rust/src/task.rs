use crate::grouping::{classify_morpheme, group_morphemes, GroupingMode};
use napi::bindgen_prelude::{Env, Error, Result, Task};
use napi_derive::napi;
use std::sync::Arc;
use sudachi::{
    analysis::{stateless_tokenizer::StatelessTokenizer, Mode, Tokenize},
    dic::dictionary::JapaneseDictionary,
};

pub struct TokenizeTask {
    pub dictionary: Arc<JapaneseDictionary>,
    pub grouping: GroupingMode,
    pub kinsoku: bool,
    pub mode: Mode,
    pub text: String,
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

        if self.grouping == GroupingMode::None && !self.kinsoku {
            return Ok(morphemes
                .iter()
                .map(|morpheme| morpheme.surface().to_string())
                .collect());
        }

        Ok(group_morphemes(
            morphemes.iter().map(|morpheme| {
                let surface = morpheme.surface();
                let part = classify_morpheme(morpheme.part_of_speech(), &surface);
                (surface.to_string(), part)
            }),
            self.grouping,
            self.kinsoku,
        ))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}
