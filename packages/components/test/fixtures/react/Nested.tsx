export default function Nested() {
  return (
    <div>
      <p>
        One
        <span className="x">
          two{" "}
          <b>
            three <i>four</i>
          </b>
        </span>
        five
      </p>
      <label>
        Email <input type="email" placeholder="you@example.com" />
      </label>
      <p>
        <b>Only bold</b>
      </p>
      <p>{"literal"}</p>
    </div>
  );
}
