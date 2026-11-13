export default {
  id: 'gemini',
  // Public Gemini DOM verified with the signed-out development probe. The
  // .ql-clipboard sibling is not a prompt editor and must never be scanned.
  selectors: [
    'rich-textarea .ql-editor[contenteditable="true"][role="textbox"]',
    'rich-textarea [contenteditable="true"][role="textbox"]',
    'rich-textarea textarea'
  ],
  composerSelector: 'input-area-v2, input-area, .input-area-container, form',
  sendSelector: 'button.send-button, button[aria-label="Send message"], button[aria-label="Send"], button[type="submit"]',
  stopSelector: 'button.stop-button, button[aria-label="Stop response"], button[aria-label="Stop generating"], button[aria-label="Stop"]',
  excludeSelector: '.ql-clipboard, user-query, model-response, [data-message-author-role], article, [role="log"], [role="dialog"]'
};
