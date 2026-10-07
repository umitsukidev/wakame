use swc_common::DUMMY_SP;
use swc_html_ast::{Child, Element, Namespace, Text};

#[derive(Clone, Debug)]
pub struct Paragraph {
    pub element_path: Vec<usize>,
    pub nodes: Vec<ParagraphNode>,
    pub forced_opportunities: Vec<usize>,
}

#[derive(Clone, Debug)]
pub struct ParagraphNode {
    pub path: Vec<usize>,
    pub text: String,
    pub can_split: bool,
}

#[derive(Clone, Debug)]
pub struct TextReplacement {
    pub path: Vec<usize>,
    pub text: String,
    pub split_offsets: Vec<usize>,
    pub append_wbr: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ElementAction {
    Inline,
    Block,
    Skip,
    Break,
    NoBreak,
    BreakOpportunity,
}

struct FlowContext {
    paragraph: Paragraph,
}

const SKIP_ELEMENTS: &[&str] = &[
    "area",
    "base",
    "basefont",
    "datalist",
    "head",
    "link",
    "meta",
    "noembed",
    "noframes",
    "param",
    "rp",
    "script",
    "style",
    "template",
    "title",
    "noscript",
    "listing",
    "plaintext",
    "pre",
    "xmp",
    "rt",
    "input",
    "select",
    "button",
    "textarea",
    "abbr",
    "code",
    "iframe",
    "time",
    "var",
];

const BLOCK_ELEMENTS: &[&str] = &[
    "html",
    "body",
    "address",
    "blockquote",
    "center",
    "dialog",
    "div",
    "figure",
    "figcaption",
    "footer",
    "form",
    "header",
    "legend",
    "main",
    "listing",
    "p",
    "article",
    "aside",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hgroup",
    "nav",
    "section",
    "dir",
    "dd",
    "dl",
    "dt",
    "menu",
    "ol",
    "ul",
    "li",
    "table",
    "caption",
    "col",
    "tr",
    "td",
    "th",
    "fieldset",
    "details",
    "summary",
    "marquee",
];

fn action_for_element(element: &Element) -> ElementAction {
    if element.namespace != Namespace::HTML {
        return ElementAction::Skip;
    }

    let name = element.tag_name.as_ref();
    if SKIP_ELEMENTS.contains(&name) {
        return ElementAction::Skip;
    }
    if name == "br" || name == "hr" {
        return ElementAction::Break;
    }
    if name == "wbr" {
        return ElementAction::BreakOpportunity;
    }
    if name == "nobr" {
        return ElementAction::NoBreak;
    }
    if BLOCK_ELEMENTS.contains(&name) {
        return ElementAction::Block;
    }
    ElementAction::Inline
}

fn new_paragraph(element_path: Vec<usize>) -> Paragraph {
    Paragraph {
        element_path,
        nodes: Vec::new(),
        forced_opportunities: Vec::new(),
    }
}

fn flush(context: &mut FlowContext, paragraphs: &mut Vec<Paragraph>) {
    if !context.paragraph.nodes.is_empty() {
        let element_path = context.paragraph.element_path.clone();
        let paragraph = std::mem::replace(&mut context.paragraph, new_paragraph(element_path));
        paragraphs.push(paragraph);
    }
}

fn add_text(context: &mut FlowContext, path: Vec<usize>, text: &str, can_split: bool) {
    if text.is_empty() {
        return;
    }

    let offset = paragraph_utf16_len(&context.paragraph);
    if can_split {
        let mut utf16_offset = 0;
        for character in text.chars() {
            if character == '\u{200b}' {
                context
                    .paragraph
                    .forced_opportunities
                    .push(offset + utf16_offset + 1);
            }
            utf16_offset += character.len_utf16();
        }
    }

    context.paragraph.nodes.push(ParagraphNode {
        path,
        text: text.to_string(),
        can_split,
    });
}

fn visit_children(
    element: &Element,
    element_path: &[usize],
    can_split: bool,
    context: &mut FlowContext,
    paragraphs: &mut Vec<Paragraph>,
) {
    for (index, child) in element.children.iter().enumerate() {
        let mut path = element_path.to_vec();
        path.push(index);
        match child {
            Child::Text(text) => add_text(context, path, &text.data, can_split),
            Child::Element(child_element) => {
                visit_element(child_element, path, Some(context), paragraphs);
            }
            Child::Comment(_) | Child::DocumentType(_) => {}
        }
    }
}

fn visit_element(
    element: &Element,
    element_path: Vec<usize>,
    parent: Option<&mut FlowContext>,
    paragraphs: &mut Vec<Paragraph>,
) {
    let action = action_for_element(element);
    if action == ElementAction::Skip {
        return;
    }

    if action == ElementAction::Break {
        if let Some(parent) = parent {
            flush(parent, paragraphs);
            parent.paragraph = new_paragraph(parent.paragraph.element_path.clone());
        }
        return;
    }

    if action == ElementAction::BreakOpportunity {
        if let Some(parent) = parent {
            parent
                .paragraph
                .forced_opportunities
                .push(paragraph_utf16_len(&parent.paragraph));
        }
        return;
    }

    let is_new_paragraph = parent.is_none() || action == ElementAction::Block;
    if is_new_paragraph {
        let mut context = FlowContext {
            paragraph: new_paragraph(element_path.clone()),
        };
        visit_children(
            element,
            &element_path,
            action != ElementAction::NoBreak,
            &mut context,
            paragraphs,
        );
        flush(&mut context, paragraphs);
    } else if let Some(parent) = parent {
        visit_children(
            element,
            &element_path,
            action != ElementAction::NoBreak,
            parent,
            paragraphs,
        );
    }
}

pub fn collect_paragraphs(children: &[Child]) -> Vec<Paragraph> {
    let mut paragraphs = Vec::new();
    for (index, child) in children.iter().enumerate() {
        if let Child::Element(element) = child
            && element.namespace == Namespace::HTML
            && element.tag_name == "html"
        {
            visit_element(element, vec![index], None, &mut paragraphs);
        }
    }
    paragraphs
}

pub fn paragraph_text(paragraph: &Paragraph) -> String {
    let mut text = String::new();
    for node in &paragraph.nodes {
        text.push_str(&node.text);
    }
    text
}

fn paragraph_utf16_len(paragraph: &Paragraph) -> usize {
    paragraph
        .nodes
        .iter()
        .map(|node| node.text.encode_utf16().count())
        .sum()
}

fn utf16_offset_to_byte_index(text: &str, target: usize) -> Option<usize> {
    let mut utf16_offset = 0;
    for (byte_index, character) in text.char_indices() {
        if utf16_offset == target {
            return Some(byte_index);
        }
        utf16_offset += character.len_utf16();
        if utf16_offset > target {
            return None;
        }
    }
    (utf16_offset == target).then_some(text.len())
}

fn text_node(data: String) -> Child {
    Child::Text(Text {
        span: DUMMY_SP,
        data: data.into(),
        raw: None,
    })
}

fn wbr_element() -> Child {
    Child::Element(Element {
        span: DUMMY_SP,
        tag_name: "wbr".into(),
        namespace: Namespace::HTML,
        attributes: Vec::new(),
        children: Vec::new(),
        content: None,
        is_self_closing: false,
    })
}

fn replace_text_node(
    children: &mut Vec<Child>,
    replacement: &TextReplacement,
) -> Result<(), String> {
    let TextReplacement {
        path,
        text,
        split_offsets,
        append_wbr,
    } = replacement;
    let Some((&index, parent_path)) = path.split_last() else {
        return Err("HTML text node path is empty".to_string());
    };
    let parent_children = children_at_path_mut(children, parent_path)
        .ok_or_else(|| "HTML text node parent no longer exists".to_string())?;
    let Some(Child::Text(_)) = parent_children.get(index) else {
        return Err("HTML text node no longer exists".to_string());
    };

    let mut replacement_children = Vec::with_capacity(split_offsets.len() * 2 + 2);
    let mut chunk_start = 0;
    for offset in split_offsets {
        let chunk_end = utf16_offset_to_byte_index(text, *offset)
            .ok_or_else(|| "Wakame boundary splits a Unicode code point".to_string())?;
        if chunk_end > chunk_start {
            replacement_children.push(text_node(text[chunk_start..chunk_end].to_string()));
        }
        replacement_children.push(wbr_element());
        chunk_start = chunk_end;
    }
    if chunk_start < text.len() {
        replacement_children.push(text_node(text[chunk_start..].to_string()));
    }
    if *append_wbr {
        replacement_children.push(wbr_element());
    }

    parent_children.splice(index..=index, replacement_children);
    Ok(())
}

fn children_at_path_mut<'a>(
    children: &'a mut Vec<Child>,
    path: &[usize],
) -> Option<&'a mut Vec<Child>> {
    let Some((index, rest)) = path.split_first() else {
        return Some(children);
    };
    let Child::Element(element) = children.get_mut(*index)? else {
        return None;
    };
    children_at_path_mut(&mut element.children, rest)
}

pub fn collect_replacements(
    paragraph: &Paragraph,
    boundaries: &[u32],
) -> Result<Vec<TextReplacement>, String> {
    let mut effective_boundaries = Vec::with_capacity(boundaries.len());
    let mut previous_boundary = 0;
    let paragraph_length = paragraph_utf16_len(paragraph);
    for boundary in boundaries {
        let boundary = *boundary as usize;
        if boundary <= previous_boundary || boundary >= paragraph_length {
            return Err("Wakame returned invalid paragraph boundary offsets".to_string());
        }
        previous_boundary = boundary;
        if !paragraph.forced_opportunities.contains(&boundary) {
            effective_boundaries.push(boundary);
        }
    }
    if effective_boundaries.is_empty() {
        return Ok(Vec::new());
    }

    let boundaries_with_sentinel: Vec<usize> = effective_boundaries
        .into_iter()
        .chain(std::iter::once(usize::MAX))
        .collect();
    let mut boundary_index = 0;
    let mut boundary = boundaries_with_sentinel[0];
    let mut offset = 0;
    let mut last_splittable = None;
    let mut split_offsets = vec![Vec::new(); paragraph.nodes.len()];
    let mut append_wbr = vec![false; paragraph.nodes.len()];

    for (node_index, node) in paragraph.nodes.iter().enumerate() {
        let node_length = node.text.encode_utf16().count();
        if node_length == 0 {
            continue;
        }
        let node_end = offset + node_length;
        if !node.can_split {
            if let Some(last_splittable) = last_splittable
                && boundary == offset
            {
                append_wbr[last_splittable] = true;
            }
            while boundary < node_end {
                boundary_index += 1;
                boundary = boundaries_with_sentinel[boundary_index];
            }
            last_splittable = None;
            offset = node_end;
            continue;
        }

        last_splittable = Some(node_index);
        if boundary >= node_end {
            offset = node_end;
            continue;
        }

        while boundary < node_end {
            split_offsets[node_index].push(boundary - offset);
            boundary_index += 1;
            boundary = boundaries_with_sentinel[boundary_index];
        }
        offset = node_end;
    }

    let mut replacements = Vec::new();
    for (node_index, node) in paragraph.nodes.iter().enumerate() {
        if split_offsets[node_index].is_empty() && !append_wbr[node_index] {
            continue;
        }
        replacements.push(TextReplacement {
            path: node.path.clone(),
            text: node.text.clone(),
            split_offsets: split_offsets[node_index].clone(),
            append_wbr: append_wbr[node_index],
        });
    }

    Ok(replacements)
}

pub fn apply_replacements(
    children: &mut Vec<Child>,
    replacements: &mut [TextReplacement],
) -> Result<(), String> {
    replacements.sort_by(|left, right| right.path.cmp(&left.path));
    for replacement in replacements {
        replace_text_node(children, replacement)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::utf16_offset_to_byte_index;

    #[test]
    fn maps_utf16_offsets_around_astral_characters() {
        assert_eq!(utf16_offset_to_byte_index("A𠮷B", 1), Some(1));
        assert_eq!(utf16_offset_to_byte_index("A𠮷B", 2), None);
        assert_eq!(utf16_offset_to_byte_index("A𠮷B", 3), Some(5));
        assert_eq!(utf16_offset_to_byte_index("A𠮷B", 4), Some(6));
    }
}
