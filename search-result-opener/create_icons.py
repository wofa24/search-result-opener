from PIL import Image, ImageDraw
import os

# 获取脚本所在目录
script_dir = os.path.dirname(os.path.abspath(__file__))
icons_dir = os.path.join(script_dir, 'icons')

# 确保icons目录存在
os.makedirs(icons_dir, exist_ok=True)

# 创建128x128的图标
img = Image.new('RGB', (128, 128), color='#0078d4')
draw = ImageDraw.Draw(img)

# 绘制白色圆形背景
draw.ellipse([20, 20, 108, 108], fill='white')

# 绘制搜索图标（放大镜）
# 圆圈
draw.ellipse([40, 40, 75, 75], outline='#0078d4', width=6)
# 手柄
draw.line([70, 70, 88, 88], fill='#0078d4', width=6)

# 绘制多个标签页的效果
draw.rectangle([50, 50, 80, 55], fill='#0078d4')
draw.rectangle([52, 58, 82, 63], fill='#0078d4')
draw.rectangle([54, 66, 84, 71], fill='#0078d4')

# 保存不同尺寸
icon128_path = os.path.join(icons_dir, 'icon128.png')
icon48_path = os.path.join(icons_dir, 'icon48.png')
icon16_path = os.path.join(icons_dir, 'icon16.png')

img.save(icon128_path)
img.resize((48, 48), Image.Resampling.LANCZOS).save(icon48_path)
img.resize((16, 16), Image.Resampling.LANCZOS).save(icon16_path)

print(f'Icons created successfully in: {icons_dir}')
print(f'  - {icon16_path}')
print(f'  - {icon48_path}')
print(f'  - {icon128_path}')
