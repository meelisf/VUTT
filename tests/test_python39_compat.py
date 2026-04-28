import ast
from pathlib import Path


SERVER_DIR = Path(__file__).resolve().parents[1] / "server"


class _Pep604AnnotationVisitor(ast.NodeVisitor):
    def __init__(self, path: Path):
        self.path = path
        self.violations = []

    def _check_annotation(self, annotation):
        if annotation is None:
            return
        for node in ast.walk(annotation):
            if isinstance(node, ast.BinOp) and isinstance(node.op, ast.BitOr):
                self.violations.append((self.path, node.lineno))

    def visit_FunctionDef(self, node):
        for arg in [*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs]:
            self._check_annotation(arg.annotation)
        if node.args.vararg:
            self._check_annotation(node.args.vararg.annotation)
        if node.args.kwarg:
            self._check_annotation(node.args.kwarg.annotation)
        self._check_annotation(node.returns)
        self.generic_visit(node)

    def visit_AsyncFunctionDef(self, node):
        self.visit_FunctionDef(node)

    def visit_AnnAssign(self, node):
        self._check_annotation(node.annotation)
        self.generic_visit(node)


def test_server_annotations_are_python39_safe():
    violations = []
    for path in sorted(SERVER_DIR.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        visitor = _Pep604AnnotationVisitor(path)
        visitor.visit(tree)
        violations.extend(visitor.violations)

    assert not violations, (
        "Production backend runs on Python 3.9. Avoid PEP 604 annotations like "
        "`dict | None` in server code unless runtime annotation evaluation is "
        f"explicitly made safe. Violations: {violations}"
    )
