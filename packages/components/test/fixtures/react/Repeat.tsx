const a = 1;
const b = { a: 2 };

export default function Repeat() {
  return (
    <>
      <p>
        {a} and {b.a} and {a}
      </p>
      <p>Save</p>
      <button>Save</button>
    </>
  );
}
