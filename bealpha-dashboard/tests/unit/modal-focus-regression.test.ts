import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("modal focus lifecycle", () => {
  it("does not restart the focus trap when an inline onClose callback changes identity", () => {
    const source = readFileSync(resolve(process.cwd(), "components/ui/Modal.tsx"), "utf8");
    expect(source).toContain("onCloseRef.current()");
    expect(source).toMatch(/useEffect\(\(\) => \{[\s\S]*?\}, \[isOpen\]\);/);
    expect(source).not.toContain("}, [isOpen, onClose]);");
  });
});
