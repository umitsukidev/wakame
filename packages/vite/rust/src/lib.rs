mod document;
mod paragraph;

use document::HtmlDocument as DocumentState;
use js_sys::{Array, Uint32Array};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct HtmlDocument {
    document: DocumentState,
}

#[wasm_bindgen]
impl HtmlDocument {
    #[wasm_bindgen(constructor)]
    pub fn new(source: &str, preserve_existing_wbr: bool) -> Result<HtmlDocument, JsValue> {
        let document = DocumentState::parse(source, preserve_existing_wbr)
            .map_err(|error| JsValue::from_str(&error))?;
        Ok(HtmlDocument { document })
    }

    pub fn paragraphs(&self) -> Array {
        let paragraphs = Array::new();
        for paragraph in self.document.paragraph_texts() {
            paragraphs.push(&JsValue::from_str(&paragraph));
        }
        paragraphs
    }

    pub fn paragraph_can_split(&self, paragraph_index: u32) -> bool {
        self.document.paragraph_can_split(paragraph_index as usize)
    }

    pub fn apply_breaks(
        &mut self,
        paragraph_index: u32,
        boundaries: Uint32Array,
        should_apply_wrap_style: bool,
    ) -> Result<(), JsValue> {
        let mut offsets = vec![0; boundaries.length() as usize];
        boundaries.copy_to(&mut offsets);
        self.document
            .apply_breaks(paragraph_index as usize, &offsets, should_apply_wrap_style)
            .map_err(|error| JsValue::from_str(&error))
    }

    pub fn serialize(&mut self) -> Result<String, JsValue> {
        self.document
            .serialize()
            .map_err(|error| JsValue::from_str(&error))
    }
}
