"""Validate or render the versioned C4 snapshot without remote includes."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess


def main():
    root = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jar", default=os.environ.get("PLANTUML_JAR"),
                        help="Path to plantuml-1.2024.5.jar (or PLANTUML_JAR)")
    parser.add_argument("--check", action="store_true",
                        help="Validate checksums and PlantUML syntax without rendering")
    args = parser.parse_args()
    if not args.jar or not Path(args.jar).is_file():
        parser.error("Provide --jar or PLANTUML_JAR pointing to plantuml-1.2024.5.jar")
    jar = Path(args.jar).resolve()
    provenance = json.loads((root / "vendor/provenance.json").read_text(encoding="utf-8"))
    for name, info in provenance["files"].items():
        actual = hashlib.sha256((root / "vendor" / name).read_bytes()).hexdigest()
        if actual != info["sha256"]:
            raise SystemExit(f"C4 library checksum mismatch: {name}")

    build = root / "build"
    build.mkdir(exist_ok=True)
    sources = sorted(root.glob("[0-9][0-9]-*.puml"))
    if not sources:
        raise SystemExit("No numbered C4 sources found")
    local_sources = []
    for source in sources:
        body = source.read_text(encoding="utf-8")
        for name in ["C4_Container.puml", "C4_Component.puml"]:
            body = body.replace(
                "https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/" + name,
                "../vendor/" + name,
            )
        body = body.replace("!include style.puml", "!include ../style.puml")
        dest = build / source.name
        dest.write_text(body, encoding="utf-8")
        local_sources.append(str(dest))

    out = root / "diagrams"
    env = dict(os.environ, PLANTUML_LIMIT_SIZE="12000")
    base = ["java", "-Djava.awt.headless=true", "-jar", str(jar),
            "-charset", "UTF-8", "-DRELATIVE_INCLUDE=1", "-failfast2",
            "-o", str(out)]
    subprocess.run(base + ["-checkonly"] + local_sources, cwd=root, env=env, check=True)
    if args.check:
        print(f"Validated {len(sources)} diagrams and C4 checksums.")
        return
    out.mkdir(exist_ok=True)
    for fmt in ["svg", "png"]:
        subprocess.run(base + ["-t" + fmt] + local_sources, cwd=root, env=env, check=True)
        for source in sources:
            output = out / (source.stem + "." + fmt)
            if not output.exists() or output.stat().st_size == 0:
                raise SystemExit(f"Missing render: {output}")
    print(f"Rendered {len(sources)} diagrams in SVG and PNG without remote includes.")


if __name__ == "__main__":
    main()
