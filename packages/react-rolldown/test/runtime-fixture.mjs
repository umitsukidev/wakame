export function createTestSegmenter() {
	return {
		segment(text) {
			return [text.slice(0, 2), text.slice(2)];
		},
	};
}
