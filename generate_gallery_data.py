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

# 图片文件名编号宽度：001.webp、002.webp ...
FILENAME_NUMBER_WIDTH = 3


def natural_sort_key(text: str):
    parts = re.split(r"(\d+)", text.lower())
    return [int(part) if part.isdigit() else part for part in parts]


def estimate_render_height(item, column_width=BASE_COLUMN_WIDTH):
    width = item["width"]
    height = item["height"]
    if width <= 0:
        return column_width
    return column_width * height / width


def get_image_key(src: str) -> str:
    """
    从路径中提取"图片身份标识"，忽略扩展名差异
    例如：assets/gallery/real/001.jpg 和 assets/gallery/real/001.webp
    都会得到同一个 key："real/001"
    """
    path = Path(src)
    # 相对于 gallery 目录的路径（去掉 assets/gallery/ 前缀）
    # 再去掉扩展名
    parts = path.parts
    # 找到 gallery 所在的位置
    try:
        gallery_index = parts.index("gallery")
        relative_parts = parts[gallery_index + 1:]
    except ValueError:
        relative_parts = parts
    # 拼接成 "real/001" 这样的 key（去掉扩展名）
    if not relative_parts:
        return path.stem
    *dirs, filename = relative_parts
    stem = Path(filename).stem
    return "/".join([*dirs, stem])


def get_supported_files(category_dir):
    return sorted(
        (
            file
            for file in category_dir.iterdir()
            if file.is_file() and file.suffix.lower() in SUPPORTED_EXTS
        ),
        key=lambda file: natural_sort_key(file.name),
    )


def build_numbered_filename(index, suffix):
    return f"{index:0{FILENAME_NUMBER_WIDTH}d}{suffix.lower()}"


def apply_rename_plan(rename_plan):
    if not rename_plan:
        return 0

    original_sources = {source for source, _ in rename_plan}
    target_paths = [target for _, target in rename_plan]

    if len(target_paths) != len(set(target_paths)):
        raise ValueError("重命名目标出现重复，请检查画廊图片文件名")

    for target in target_paths:
        if target.exists() and target not in original_sources:
            raise FileExistsError(f"目标文件已存在，停止重命名: {target}")

    temp_plan = []
    for index, (source, target) in enumerate(rename_plan, start=1):
        temp = source.with_name(f".gallery-renumber-tmp-{index:03d}-{source.name}")
        suffix = 1
        while temp.exists():
            temp = source.with_name(f".gallery-renumber-tmp-{index:03d}-{suffix}-{source.name}")
            suffix += 1

        source.rename(temp)
        temp_plan.append((temp, target))

    for temp, target in temp_plan:
        temp.rename(target)

    return len(rename_plan)


def renumber_gallery_files():
    """
    按分类对图片自然排序，并把文件名补齐为连续编号。
    返回 new_key -> old_key，用于重命名后继续保持旧的布局顺序。
    """
    previous_key_by_current_key = {}
    total_renamed = 0

    for category in CATEGORIES:
        category_dir = GALLERY_DIR / category
        if not category_dir.exists():
            continue

        files = get_supported_files(category_dir)
        rename_plan = []

        for index, file in enumerate(files, start=1):
            target = category_dir / build_numbered_filename(index, file.suffix)
            old_src = file.relative_to(BASE_DIR).as_posix()
            new_src = target.relative_to(BASE_DIR).as_posix()

            previous_key_by_current_key[get_image_key(new_src)] = get_image_key(old_src)

            if file != target:
                rename_plan.append((file, target))

        renamed_count = apply_rename_plan(rename_plan)
        total_renamed += renamed_count

        if renamed_count:
            print(f"{category} 已重新编号 {renamed_count} 张图片")

    if total_renamed:
        print(f"共重新编号 {total_renamed} 张图片")

    return previous_key_by_current_key


def collect_images():
    items = []

    for category in CATEGORIES:
        category_dir = GALLERY_DIR / category
        if not category_dir.exists():
            print(f"警告：未找到文件夹 {category_dir}")
            continue

        for file in get_supported_files(category_dir):
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

    items.sort(key=lambda x: (x["category"], natural_sort_key(x["filename"])))
    return items


def parse_existing_gallery_data():
    """
    从旧的 gallery-data.js 中提取"图片身份标识 → order"的映射
    用 key（类似 real/001）而不是完整 src,这样格式变化（jpg→webp）不会破坏映射
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
        key = get_image_key(src)
        existing[key] = order

    return existing


def distribute_existing_items(existing_items, column_count=COLUMN_COUNT):
    """
    旧图：尽量按原 order 保持稳定
    用"轮转列分配"近似恢复原布局节奏
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
        # 用 key 匹配（real/001 这种），不再用完整 src
        key = item.get("previous_key") or get_image_key(item["src"])
        if key in existing_order_map:
            item["old_order"] = existing_order_map[key]
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
    existing_order_map = parse_existing_gallery_data()
    previous_key_by_current_key = renumber_gallery_files()
    all_items = collect_images()

    for item in all_items:
        current_key = get_image_key(item["src"])
        item["previous_key"] = previous_key_by_current_key.get(current_key, current_key)

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

    # 基于 key 统计（和 build_arrangement 里的判断一致）
    all_keys = {item.get("previous_key") or get_image_key(item["src"]) for item in all_items}
    existing_count = sum(1 for key in all_keys if key in existing_order_map)
    new_count = len(all_keys) - existing_count

    print(f"已生成: {OUTPUT_FILE}")
    print(f"共写入 {len(arranged_items)} 张图片")
    print(f"保留布局的旧图: {existing_count} 张")
    print(f"新增图片: {new_count} 张")
    print(f"基准列数: {COLUMN_COUNT}")


if __name__ == "__main__":
    main()
