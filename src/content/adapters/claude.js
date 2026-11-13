export default {
  id: 'claude',
  // Explicit chat-input markers first. Older Claude composers use ProseMirror
  // without an id/role; the fallback excludes messages, dialogs, and artifacts.
  selectors: [
    '[data-testid="chat-input"][contenteditable="true"]',
    '[data-testid="chat-input"] .ProseMirror[contenteditable="true"]',
    'textarea[data-testid="chat-input"]',
    '.ProseMirror[contenteditable="true"][aria-label*="Claude" i]',
    'fieldset .ProseMirror[contenteditable="true"]',
    '.ProseMirror[contenteditable="true"]'
  ],
  composerSelector: 'fieldset, form',
  sendSelector: 'button[aria-label="Send message"], button[aria-label="Send Message"], button[data-testid="send-button"], button[type="submit"]',
  stopSelector: 'button[aria-label="Stop response"], button[aria-label="Stop generating"], button[aria-label="Stop Response"], button[data-testid="stop-button"]',
  excludeSelector: '[data-testid="user-message"], [data-testid="assistant-message"], [data-testid="chat-message"], [data-testid="artifact-panel"], [data-testid="artifact"], [data-testid="artifact-view"], [data-message-author-role], article, [role="log"], [role="dialog"]'
};
