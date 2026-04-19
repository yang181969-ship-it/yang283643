# Gosper算法
@category: 组合数学
@date: 2026-04-19

在对某个数列$\{x_n\}$作求和操作时，我们总是希望可以对数列裂项，这样求和几乎可以说是毫无难度的。
换句话说，我们想要的求和步骤是：

$$
\sum_{i=m}^n {x_i}=\sum_{i=m}^n ({X_{i+1}}-{X_i})={X_{n+1}}-{X_m} \tag{0}
$$

那么对于给定的数列$\{x_n\}$，我们该如何知道它可不可以裂项，并在知道其可以裂项的前提下求出$\{X_n\}$呢？
1977年R.W.Gosper给出了针对超几何项的系统计算方法

## 1.Gosper算法步骤
Step 1:
取数列的相邻两项做比，并将比值写为一个特殊形式

$$
\frac{x_{n+1}}{x_n}=\frac{p_{n+1}}{p_n} \frac{q_n}{r_{n+1}} \tag{1}
$$

其中p,q,r均为多项式并且满足：

$$
若 n+{\alpha}|q_n，n+{\beta}|r_n，则 {\alpha}-{\beta} \notin \mathbb{N}^* \tag{2}
$$
这个条件是容易达到的，我们暂且从$p_n \equiv 1$开始，并且设$q_n和r_{n+1}$分别是做比之后的分母和分子，然后检验它们是否符合条件(2)，如果p,q存在因子${n+\alpha}$和${n+\beta}$并且违反了条件(2)，那就把它们从q和r中除掉，并用

$$
p_n(n+{\alpha}-1)(n+{\alpha}-2)...(n+{\beta}+1) \tag{3}
$$

代替原来的$p_n$，这样新的p,q,r仍然满足式(1)，这个过程可以一直重复下去，直到得到的p,q,r满足条件(2)


Step 2:
由上一步中得到的q,r计算出：$Q_n=q_n-r_n$，$R_n=q_n+r_n$，并且比较这两个新多项式的次数，得到重要指标:d

$$
\begin{cases}
\deg(Q_n) \ge \deg(R_n) & 则 \quad d = \deg(p_n) - \deg(Q_n) \\
\deg(Q_n) \le \deg(R_n) & 则 \quad d = \deg(p_n) - \deg(R_n) + 1 \quad \text{或} \quad d = \frac{2\lambda^{'}}{\lambda}
\end{cases}
$$

这里的d就是判断数列$\{x_n\}$是否可以列项的指标，如果$d \ge 0$那么数列$\{x_n\}$可以裂项，反之则不行


Step 3:
当$d \ge 0$时，解Gosper方程

$$
p_n=q_n s_{n+1}-r_n s_n \tag{4}
$$

其中$s_n$是一个未知多项式，并且$deg(s_n)=d$


Step 4:
得到$s_n$以后，就有

$$
X_n=\frac{x_n r_n s_n}{p_n} \tag{5}
$$

这就是式(0)中的$X_n$，到这里，对数列\{x_n\}的裂项就完成了！

## 2.算法原理
接下来我们来探究这个方法的原理，并解释每一步是为什么
