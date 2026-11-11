import type { ReactNode } from "react";
import Card from "./Card.tsx";
import Icon from "./Icon.tsx";

const Ui = { Note: ({ children }: { children?: ReactNode }) => <aside>{children}</aside> };

export default function Components() {
  return (
    <>
      <Card title="Card title" footer={<em>Footer text</em>}>
        Card body text
      </Card>
      <p>
        Press <Icon /> to close
      </p>
      <Ui.Note>A member component</Ui.Note>
    </>
  );
}
