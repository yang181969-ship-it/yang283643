# 网站公式书写语法说明

@category: 公式渲染
@date: 2026-04-19

本网站笔记页面支持 **LaTeX 风格的数学公式**，通过 KaTeX 渲染。本文档将介绍公式书写的基本语法和注意事项。

## 1. 行内公式

行内公式使用 $ 包裹，例如：
```markdown
这是一个行内公式：$E=mc^2$。
```

渲染效果：
这是一个行内公式：$E=mc^2$。

## 2. 块级公式

块级公式可以使用 $$ 或 \[...\] 包裹，例如：

```markdown
$$
f(x) = \int_{-\infty}^{\infty} e^{-t^2} dt
$$
```

或者

```markdown
\[
f(x) = \sum_{n=0}^{\infty} \frac{x^n}{n!}
\]
```

渲染效果：

$$
f(x) = \int_{-\infty}^{\infty} e^{-t^2} dt
$$

\[
f(x) = \sum_{n=0}^{\infty} \frac{x^n}{n!}
\]

## 3. 常用数学符号示例

* 上下标：`x_i`, `x^2` → $x_i, x^2$
* 分数：`\frac{a}{b}` → $\frac{a}{b}$
* 根号：`\sqrt{x}` → $\sqrt{x}$
* 求和：`\sum_{i=1}^{n} i` → $\sum_{i=1}^{n} i$
* 积分：`\int_0^1 x dx` → $\int_0^1 x dx$
* 向量/矩阵：`\vec{v}`, `\begin{bmatrix}a & b\\ c & d\end{bmatrix}` → $\vec{v}, \begin{bmatrix}a & b\\ c & d\end{bmatrix}$

## 4. 注意事项

1. **行内公式** 不应跨行，否则会导致渲染错误。
2. **块级公式** 一定要单独占一行。
3. 公式内部尽量使用 LaTeX 标准命令，避免特殊符号导致解析失败。
4. 如果公式未渲染，请检查：

   * 是否正确使用单个或两个$符号包裹；
   * 是否存在 HTML 标签冲突；
   * 确保笔记已加载完成并触发 KaTeX 渲染。

## 5. 高级用法

网站支持大部分 KaTeX 命令，包括：

* 矩阵、分段函数
* 上下标、求和、积分
* 常用函数符号如 $\sin, \cos, \log$

示例：

```markdown
\[
f(x) = \begin{cases}
x^2, & x \ge 0 \\
-x, & x < 0
\end{cases}
\]
```

渲染效果：

\[
f(x) = \begin{cases}
x^2, & x \ge 0 \\
-x, & x < 0
\end{cases}
\]