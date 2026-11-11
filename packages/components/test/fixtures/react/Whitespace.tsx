const n = 2;

export default function Whitespace() {
  return (
    <>
      <div>
        <span>Tight</span>
        <span>words</span>
      </div>
      <div>
        <b>Bold</b> <i>italic</i>
      </div>
      <p>lots of spaces</p>
      <span> padded {n} </span>
      <p>a&nbsp;b &amp; c &lt;tag&gt; &#169; &#x2014;</p>
      <p>
        {n} <b>x</b> {n}
      </p>
      <p>Tabbed across lines</p>
      <p>first line after a blank line</p>
    </>
  );
}
