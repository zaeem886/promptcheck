export default {
  id: 'chatgpt',
  selectors: [
    '#prompt-textarea[contenteditable="true"]',
    'textarea#prompt-textarea',
    '[contenteditable="true"][data-testid="prompt-textarea"]',
    '[contenteditable="true"][role="textbox"][data-composer-markdown]'
  ],
  composerSelector: 'form',
  sendSelector: 'button[data-testid="send-button"], button[data-testid="composer-send-button"], button[aria-label="Send prompt"], button[aria-label="Send message"], button[type="submit"]',
  stopSelector: 'button[data-testid="stop-button"], button[aria-label="Stop generating"], button[aria-label="Stop response"]',
  excludeSelector: '[data-message-author-role], [data-testid="conversation-turn"], article, [role="log"], [role="dialog"]'
};
