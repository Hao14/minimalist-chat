const quickReactions = ['👍', '❤️', '😂', '🎉', '😮', '😢'];

const emojiCatalog = [
  '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '🥲', '😊', '😇', '🙂', '🙃', '😉', '😌',
  '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎',
  '🥸', '🤩', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩',
  '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥',
  '😓', '🤗', '🤔', '🫡', '🤭', '🫢', '🤫', '🤥', '😶', '🫥', '😐', '😑', '😬', '🙄', '😯',
  '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐', '🥴', '🤢', '🤮', '🤧', '😷',
  '🤒', '🤕', '🤑', '🤠', '🥳', '😈', '👿', '👹', '👺', '🤡', '💩', '👻', '💀', '☠️', '👽',
  '👾', '🤖', '🎃', '👍', '👎', '👌', '🤌', '🤏', '✌️', '🤞', '🫰', '🤟', '🤘', '🤙', '👈',
  '👉', '👆', '👇', '☝️', '👋', '🤚', '🖐️', '✋', '🖖', '🫶', '🤝', '🙏', '✊', '👊', '🤛',
  '🤜', '👏', '🙌', '👐', '🤲', '💪', '🦾', '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍',
  '🤎', '💔', '❤️‍🔥', '❤️‍🩹', '💯', '💢', '💥', '💫', '💦', '💨', '🔥', '⭐', '🌟', '✨',
  '⚡', '🎉', '🎊', '🎈', '🎁', '🏆', '🥇', '💎', '👑', '🐶', '🐱', '🐭', '🐹', '🐰', '🦊',
  '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🦄', '🐝', '🦋', '🍕',
  '🍔', '🍟', '🌮', '🍣', '🍦', '🍩', '🍪', '🎂', '🍰', '🍫', '🍿', '☕', '🍺', '🍻', '🥂',
  '🍷', '🍸',
];

const emojis = [...new Set([...quickReactions, ...emojiCatalog])];

const picker = document.getElementById('emoji-picker');

if (picker) {
  picker.setAttribute('role', 'dialog');
  picker.setAttribute('aria-label', 'Choose a reaction');
  picker.setAttribute('aria-modal', 'false');

  window.ensureEmojiPickerOptions = function ensureEmojiPickerOptions() {
    if (picker.querySelector('.emoji-option')) return;
    picker.replaceChildren();

    const fragment = document.createDocumentFragment();
    emojis.forEach((emoji, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `emoji-option${index < quickReactions.length ? ' is-quick-reaction' : ''}`;
      button.textContent = emoji;
      button.title = `React with ${emoji}`;
      button.setAttribute('aria-label', `React with ${emoji}`);
      button.addEventListener('click', () => window.addReaction?.(emoji));
      fragment.appendChild(button);
    });
    picker.appendChild(fragment);
  };

  picker.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      window.closeEmojiPicker?.({ restoreFocus: true });
      return;
    }

    const options = Array.from(picker.querySelectorAll('.emoji-option'));
    const currentIndex = options.indexOf(document.activeElement);
    if (currentIndex < 0 || options.length < 2) return;

    let nextIndex = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (currentIndex + 1) % options.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + options.length) % options.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = options.length - 1;
    }

    if (nextIndex === null) return;
    event.preventDefault();
    options[nextIndex]?.focus();
  });

  window.addEventListener('resize', () => {
    if (!picker.classList.contains('hidden')) window.closeEmojiPicker?.();
  });
  document.addEventListener('scroll', (event) => {
    if (picker.classList.contains('hidden')) return;
    const target = event.target instanceof Node ? event.target : null;
    if (target && picker.contains(target)) return;
    window.closeEmojiPicker?.();
  }, true);
}
