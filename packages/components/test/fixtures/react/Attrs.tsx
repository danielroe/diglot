const banner = <p title="Outside any component">Module level text</p>;

export default function Attrs() {
  return (
    <div>
      <img src="/logo.png" alt="Company logo" />
      <input type="text" placeholder="Search messages" name="q" />
      <button title="Close the dialog" aria-label="Close">
        ×
      </button>
      <a href="/x" title="Open" translate="no">
        Out
      </a>
      <abbr title="Tom &amp; Jerry">T&amp;J</abbr>
      {banner}
    </div>
  );
}
