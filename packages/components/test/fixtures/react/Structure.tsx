const items = ["a", "b"];
const ok = true;
const empty: string[] = [];

export default function Structure() {
  return (
    <>
      <ul>
        {items.map((item) => (
          <li key={item}>Item {item} is ready</li>
        ))}
      </ul>
      <p>Status: {ok ? <span>all good</span> : <span>broken</span>}</p>
      {ok && <>Inside a fragment</>}
      {empty.length === 0 && <p>Nothing here yet</p>}
      <div>
        Before block
        <div>Inner block</div>
        After block
      </div>
    </>
  );
}
