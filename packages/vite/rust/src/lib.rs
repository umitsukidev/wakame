use swc_common::{FileName, SourceMap, sync::Lrc};
use swc_html_ast::Document;
use swc_html_codegen::{
    CodeGenerator, CodegenConfig, Emit,
    writer::basic::{BasicHtmlWriter, BasicHtmlWriterConfig},
};
use swc_html_parser::{parse_file_as_document, parser::ParserConfig};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct HtmlDocument {
    document: Document,
}

#[wasm_bindgen]
impl HtmlDocument {
    #[wasm_bindgen(constructor)]
    pub fn new(source: &str) -> Result<HtmlDocument, JsValue> {
        let source_map = Lrc::<SourceMap>::default();
        let source_file = source_map.new_source_file(FileName::Anon.into(), source.to_string());
        let mut errors = Vec::new();
        let document =
            parse_file_as_document(source_file.as_ref(), ParserConfig::default(), &mut errors)
                .map_err(|error| JsValue::from_str(&error.message()))?;

        Ok(HtmlDocument { document })
    }

    pub fn serialize(&self) -> Result<String, JsValue> {
        let mut output = String::new();
        let writer = BasicHtmlWriter::new(&mut output, None, BasicHtmlWriterConfig::default());
        let mut generator = CodeGenerator::new(writer, CodegenConfig::default());
        generator
            .emit(&self.document)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        Ok(output)
    }
}

#[cfg(test)]
mod tests {
    use super::HtmlDocument;

    #[test]
    fn parses_and_serializes_html() {
        let document = HtmlDocument::new("<p>日本語 &amp; HTML</p>").unwrap();
        let output = document.serialize().unwrap();
        assert!(output.contains("日本語 &amp; HTML"));
    }
}
