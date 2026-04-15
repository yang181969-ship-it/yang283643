from pathlib import Path
from PIL import Image
import re

# ===== 路径配置 =====
BASE_DIR = Path(__file__).resolve().parent
GALLERY_DIR = BASE_DIR / "assets" / "gallery"
OUTPUT_FILE = BASE_DIR / "js" / "gallery-data.js"

SUPPORTED_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
CATEGORIES = ["real", "anime"]

# 按桌面端估算
COLUMN_COUNT = 5
BASE_COLUMN_WIDTH = 300


def natural_sort_key(text: str):
    parts = re.split(r"(\d+)", text.lower())
    return [int(part) if part.isdigit() else part for part in parts]


def estimate_render_height(item, column_width=BASE_COLUMN_WIDTH):
    width = item["width"]
    height = item["height"]
    if width <= 0:
        return column_width
    return column_width * height / width


def collect_images():
    items = []

    for category in CATEGORIES:
        category_dir = GALLERY_DIR / category
        if not category_dir.exists():
            print(f"警告：未找到文件夹 {category_dir}")
            continue

        for file in category_dir.iterdir():
            if not file.is_file():
                continue
            if file.suffix.lower() not in SUPPORTED_EXTS:
                continue

            try:
                with Image.open(file) as img:
                    width, height = img.size
            except Exception as e:
                print(f"跳过无法读取的图片: {file} ({e})")
                continue

            if width <= 0 or height <= 0:
                continue

            items.append({
                "src": file.relative_to(BASE_DIR).as_posix(),
                "category": category,
                "width": width,
                "height": height,
                "filename": file.name,
            })

    # 这里只做稳定收集顺序，便于新图排序时可预测
    items.sort(key=lambda x: (x["category"], natural_sort_key(x["filename"])))
    return items


def parse_existing_gallery_data():
    """
    从旧的 gallery-data.js 中尽量提取已有图片的 src 和 order
    只做轻量解析，够当前场景使用
    """
    if not OUTPUT_FILE.exists():
        return {}

    text = OUTPUT_FILE.read_text(encoding="utf-8")

    pattern = re.compile(
        r'src:\s*"([^"]+)"[\s\S]*?order:\s*(\d+)',
        re.MULTILINE
    )

    existing = {}
    for match in pattern.finditer(text):
        src = match.group(1)
        order = int(match.group(2))
        existing[src] = order

    return existing


def distribute_existing_items(existing_items, column_count=COLUMN_COUNT):
    """
    旧图：尽量按原 order 保持稳定
    用“轮转列分配”近似恢复原布局节奏
    """
    existing_items = sorted(existing_items, key=lambda x: x["old_order"])

    columns = [{"height": 0, "items": []} for _ in range(column_count)]

    for index, item in enumerate(existing_items):
        col_index = index % column_count
        columns[col_index]["items"].append(item)
        columns[col_index]["height"] += estimate_render_height(item)

    return columns


def place_new_items(columns, new_items):
    """
    新图：优先放进当前最短列
    为了更好补洞，先把高图优先放
    """
    new_items = sorted(new_items, key=lambda x: estimate_render_height(x), reverse=True)

    for item in new_items:
        target_col = min(columns, key=lambda col: col["height"])
        target_col["items"].append(item)
        target_col["height"] += estimate_render_height(item)

    return columns


def interleave_columns(columns):
    """
    按列交错输出，得到最终顺序
    """
    arranged = []
    max_len = max((len(col["items"]) for col in columns), default=0)

    for row_index in range(max_len):
        for col in columns:
            if row_index < len(col["items"]):
                arranged.append(col["items"][row_index])

    for i, item in enumerate(arranged, start=1):
        item["order"] = i

    return arranged


def build_arrangement(all_items, existing_order_map):
    existing_items = []
    new_items = []

    for item in all_items:
        if item["src"] in existing_order_map:
            item["old_order"] = existing_order_map[item["src"]]
            existing_items.append(item)
        else:
            new_items.append(item)

    # 旧图尽量稳定
    columns = distribute_existing_items(existing_items, column_count=COLUMN_COUNT)

    # 新图优先补最短列
    columns = place_new_items(columns, new_items)

    # 最终交错输出
    arranged = interleave_columns(columns)
    return arranged


def generate_js(items):
    lines = []
    lines.append("// 由 generate_gallery_data.py 自动生成，请勿手动修改")
    lines.append("const galleryData = [")

    for item in items:
      lines.append(
          "  { "
          f'src: "{item["src"]}", '
          f'category: "{item["category"]}", '
          f'width: {item["width"]}, '
          f'height: {item["height"]}, '
          f'order: {item["order"]} '
          "},"
      )

    lines.append("];")
    lines.append("")
    return "\n".join(lines)


def main():
    all_items = collect_images()
    existing_order_map = parse_existing_gallery_data()

    if not all_items:
        OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT_FILE.write_text(
            "// 由 generate_gallery_data.py 自动生成，请勿手动修改\nconst galleryData = [];\n",
            encoding="utf-8"
        )
        print("未找到可用图片，已生成空的 gallery-data.js")
        return

    arranged_items = build_arrangement(all_items, existing_order_map)
    js_content = generate_js(arranged_items)

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(js_content, encoding="utf-8")

    old_count = len(existing_order_map)
    new_count = sum(1 for item in all_items if item["src"] not in existing_order_map)

    print(f"已生成: {OUTPUT_FILE}")
    print(f"共写入 {len(arranged_items)} 张图片")
    print(f"旧图数量: {old_count}")
    print(f"新图数量: {new_count}")
    print(f"基准列数: {COLUMN_COUNT}")


if __name__ == "__main__":
    main()