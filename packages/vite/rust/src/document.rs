use swc_common::{DUMMY_SP, FileName, SourceMap, sync::Lrc};
use swc_html_ast::{Attribute, Child, Document, Element, Namespace};
use swc_html_codegen::{
    CodeGenerator, CodegenConfig, Emit,
    writer::basic::{BasicHtmlWriter, BasicHtmlWriterConfig},
};
use swc_html_parser::{parse_file_as_document, parser::ParserConfig};

use crate::paragraph::{
    Paragraph, TextReplacement, apply_replacements, collect_paragraphs, collect_replacements,
    paragraph_text,
};

const WRAP_STYLE: &str = "word-break: keep-all; overflow-wrap: anywhere;";

pub struct HtmlDocument {
    document: Document,
    paragraphs: Vec<Paragraph>,
    pending_replacements: Vec<TextReplacement>,
    pending_styles: Vec<Vec<usize>>,
}

impl HtmlDocument {
    pub fn parse(source: &str, preserve_existing_wbr: bool) -> Result<Self, String> {
        let source_map = Lrc::<SourceMap>::default();
        let source_file = source_map.new_source_file(FileName::Anon.into(), source.to_string());
        let mut errors = Vec::new();
        let mut document =
            parse_file_as_document(source_file.as_ref(), ParserConfig::default(), &mut errors)
                .map_err(|error| error.message().into_owned())?;

        if !preserve_existing_wbr {
            remove_existing_wbrs(&mut document.children);
        }
        let paragraphs = collect_paragraphs(&document.children);

        Ok(HtmlDocument {
            document,
            paragraphs,
            pending_replacements: Vec::new(),
            pending_styles: Vec::new(),
        })
    }

    pub fn paragraph_texts(&self) -> Vec<String> {
        self.paragraphs.iter().map(paragraph_text).collect()
    }

    pub fn paragraph_can_split(&self, paragraph_index: usize) -> bool {
        self.paragraphs
            .get(paragraph_index)
            .is_some_and(|paragraph| paragraph.nodes.iter().any(|node| node.can_split))
    }

    pub fn apply_breaks(
        &mut self,
        paragraph_index: usize,
        boundaries: &[u32],
        should_apply_wrap_style: bool,
    ) -> Result<(), String> {
        let paragraph = self
            .paragraphs
            .get(paragraph_index)
            .ok_or_else(|| "Wakame paragraph index is out of range".to_string())?;
        self.pending_replacements
            .extend(collect_replacements(paragraph, boundaries)?);
        if should_apply_wrap_style {
            self.pending_styles.push(paragraph.element_path.clone());
        }
        Ok(())
    }

    pub fn serialize(&mut self) -> Result<String, String> {
        for element_path in std::mem::take(&mut self.pending_styles) {
            apply_wrap_style(&mut self.document.children, &element_path)?;
        }
        let mut pending_replacements = std::mem::take(&mut self.pending_replacements);
        apply_replacements(&mut self.document.children, &mut pending_replacements)?;

        let mut output = String::new();
        let writer = BasicHtmlWriter::new(&mut output, None, BasicHtmlWriterConfig::default());
        let mut generator = CodeGenerator::new(writer, CodegenConfig::default());
        generator
            .emit(&self.document)
            .map_err(|error| error.to_string())?;
        Ok(output)
    }
}

fn remove_existing_wbrs(children: &mut Vec<Child>) {
    let mut index = 0;
    while index < children.len() {
        let Child::Element(element) = &mut children[index] else {
            index += 1;
            continue;
        };
        if element.namespace != Namespace::HTML {
            index += 1;
            continue;
        }
        if element.tag_name == "wbr" {
            children.remove(index);
            continue;
        }
        remove_existing_wbrs(&mut element.children);
        index += 1;
    }
}

fn element_at_path_mut<'a>(children: &'a mut [Child], path: &[usize]) -> Option<&'a mut Element> {
    let (index, rest) = path.split_first()?;
    let Child::Element(element) = children.get_mut(*index)? else {
        return None;
    };
    if rest.is_empty() {
        Some(element)
    } else {
        element_at_path_mut(&mut element.children, rest)
    }
}

fn apply_wrap_style(children: &mut [Child], element_path: &[usize]) -> Result<(), String> {
    let element = element_at_path_mut(children, element_path)
        .ok_or_else(|| "Wakame paragraph element no longer exists".to_string())?;
    if let Some(style) = element
        .attributes
        .iter_mut()
        .find(|attribute| attribute.name == "style")
    {
        let existing_style = style.value.as_deref().unwrap_or_default().trim();
        if existing_style.contains(WRAP_STYLE) {
            return Ok(());
        }
        let separator = if existing_style.ends_with(';') {
            " "
        } else {
            "; "
        };
        style.value = Some(
            if existing_style.is_empty() {
                WRAP_STYLE.to_string()
            } else {
                format!("{existing_style}{separator}{WRAP_STYLE}")
            }
            .into(),
        );
        style.raw_value = None;
        return Ok(());
    }

    element.attributes.push(Attribute {
        span: DUMMY_SP,
        namespace: None,
        prefix: None,
        name: "style".into(),
        raw_name: None,
        value: Some(WRAP_STYLE.into()),
        raw_value: None,
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::HtmlDocument;

    #[test]
    fn preserves_and_recomputes_existing_wbrs() {
        let mut preserved = HtmlDocument::parse("<p>日<wbr>本語</p>", true).unwrap();
        let mut recomputed = HtmlDocument::parse("<p>日<wbr>本語</p>", false).unwrap();
        let preserved_output = preserved.serialize().unwrap();
        let recomputed_output = recomputed.serialize().unwrap();
        assert!(preserved_output.contains("<wbr>"));
        assert!(!recomputed_output.contains("<wbr>"));
    }

    #[test]
    fn removes_only_html_wbr_elements() {
        let mut document = HtmlDocument::parse(
            "<html><body><p>日<wbr>本</p><svg><wbr></wbr></svg></body></html>",
            false,
        )
        .unwrap();
        let output = document.serialize().unwrap();
        let svg_index = output.find("<svg").expect("SVG element should remain");
        assert!(!output[..svg_index].contains("<wbr"));
        assert!(output[svg_index..].contains("wbr"));
    }

    #[test]
    fn inserts_breaks_across_inline_nodes_and_nobr_boundaries() {
        let mut document = HtmlDocument::parse(
            "<html><body><p>日<b>本</b><nobr>語</nobr>です</p></body></html>",
            true,
        )
        .unwrap();
        assert_eq!(document.paragraph_texts(), ["日本語です"]);
        document.apply_breaks(0, &[1, 2, 3], true).unwrap();
        let output = document.serialize().unwrap();
        assert!(output.contains("<b><wbr>本<wbr></b>"));
        assert!(
            output.contains("日<b><wbr>本<wbr></b><nobr>語</nobr><wbr>です"),
            "{output}"
        );
        assert!(output.contains("word-break: keep-all; overflow-wrap: anywhere;"));
    }
}
