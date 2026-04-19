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
\frac{x_{n+1}}{x_n}=\frac{p(n+1)}{p(n)} \frac{q(n)}{r(n+1)} \tag{1}
$$

其中p,q,r均为多项式并且满足：

$$
若 n+{\alpha}|q(n)，n+{\beta}|r(n)，则 {\alpha}-{\beta} \notin \mathbb{N}^* \tag{2}
$$
这个条件是容易达到的，我们暂且从$p(n) \equiv 1$开始，并且设$q()n和r(n+1)$分别是做比之后的分母和分子，然后检验它们是否符合条件(2)，如果p,q存在因子${n+\alpha}$和${n+\beta}$并且违反了条件(2)，那就把它们从q和r中除掉，并用

$$
p(n) (n+{\alpha}-1)(n+{\alpha}-2)...(n+{\beta}+1) \tag{3}
$$

代替原来的$p_n$，这样新的p,q,r仍然满足式(1)，这个过程可以一直重复下去，直到得到的p,q,r满足条件(2)


Step 2:
由上一步中得到的q,r计算出：$Q(n)=q(n)-r(n)$，$R(n)=q(n)+r(n)$，并且比较这两个新多项式的次数，得到重要指标:d

$$
\begin{cases}
\deg(Q(n)) \ge \deg(R(n)) & 则 \quad d = \deg(p(n)) - \deg(Q(n)) \\
\deg(Q(n)) < \deg(R(n)) & 则 \quad d = \deg(p(n)) - \deg(R(n)) + 1 \quad \text{或} \quad d = \frac{2\lambda^{'}}{\lambda}
\end{cases}
$$

这里的d就是判断数列$\{x_n\}$是否可以列项的指标，如果$d \ge 0$那么数列$\{x_n\}$可以裂项，反之则不行


Step 3:
当$d \ge 0$时，解Gosper方程

$$
p(n)=q(n) s(n)-r(n) s(n) \tag{4}
$$

其中$s(n)$是一个未知多项式，并且$deg(s(n))=d$


Step 4:
得到$s(n)$以后，就有

$$
X_n=\frac{x_n r(n) s(n)}{p(n)} \tag{5}
$$

这就是式(0)中的$X_n$，到这里，对数列\{x_n\}的裂项就完成了！

## 2.算法原理
接下来我们来探究这个方法的原理

Gosper经历漫长研究后才得到式(1)的结果，所以可以说式(1)是靠经验得出的
得到式(1)后，他又靠大量研究得到了式(5)的表达式，他认为设一个未知函数$s(n)$再将$X_n$写为式(5)的形式是明智的
随后再做出$X_n$的差分，利用式(0)化简有

$$
\small{x_n=X_{n+1}-X_n 
=\frac{x_{n+1} r(n+1) s(n+1)}{p(n+1)}-\frac{x_n r(n) s(n)}{p(n)}
=\frac{x_n}{p(n)} (q(n) s(n+1)-r(n) s(n)) }
\tag{6}
$$

从而可以知道$s(n)$要满足的条件为$p(n)=q(n) s(n)-r(n) s(n)$，这就是式(4)，也即Gosper方程

而且事实上可以从式(6)中得到$s(n)$一定是一个多项式，下面就来证明这一点

由于$x_n$是超几何项，所以$X_n$也是超几何项，从而$\frac{X_{n+1}}{X_n}$是一个有理函数，再由式(5)可知$s(n)$是一个有理函数，不妨设为$s(n)=\frac{f(n)}{g(n)}，(f(n),g(n))=1$，从而式(4)可以改写为

$$
p(n) g(n) g(n+1)=q(n) f(n+1) g(n)-r(n) f(n) g(n+1) \tag{7}
$$

如果$s(n)$不是多项式，则$g(n)不是常数$，并设$N$是对某个$\beta in \mathbb{C}$满足$(n+\beta)|g(n),(n+\beta +N-1)|g(n)$的最大整数，因为$N=1$总是满足要求，所以$N \ge 1 > 0$，式(7)中分别令$n=\beta$及$n=\beta -N$就得到

$$
r(-\beta) g(1-\beta) f(-\beta)=0=q(-\beta -N) f(1-\beta -N) g(-\beta -N) \tag{8}
$$

现在$f(-\beta) \ne 0$，并且$f(-\beta -N) \ne 0$，因为有$(f(n),g(n))=1$。同样$g(1-\beta) \ne 0$，并且$g(-\beta -N) \ne 0$，否则$g(n)$会有因子$(n+\beta -1)$和$(n+\beta +N)$，这与$N$的最大性矛盾，从而有

$$
r(-\beta)=q(-\beta -N)
$$

但是这违反了条件(2)，从而$s(n)$是一个多项式

现在只要知道$s(n)$的次数就可以从Gosper方程中解出$s(n)$了，所以$s(n)$的次数d是判断数列是否能裂项的重要指标，将式(4)改写为

$$
2p(n)=Q(n)(s(n+1)+s(n))+R(n)(s(n+1)-s(n)) \tag{9}
$$

其中$Q(n)=q(n)-r(n),R(n)=q(n)+r(n)$

现在设$deg(s(n))=d，s(n)=s_d n^d +s_{d-1} n^{d-1} + ... +s_1 d + s_0$

则有$deg(s(n+1)+s(n))=d,deg(s(n+1)-s(n))=d-1$

此时若$\deg(Q(n)) \ge \deg(R(n))$，那么式(9)右边的次数为$deg(Q(n))+d$，左边的次数为$deg(p(n))$,从而$d=deg(p(n))-deg(R(n))$

若$\deg(Q(n)) < \deg(R(n))$，则记$Q(n)=\lambda ^{'} n^{d^{'}}+...$ 以及 $R(n)=\lambda n^{d^{'}}+...$
这样式(9)右边为 $(2\lambda^{'}+\lambda) s(n) n^{d+d^{'}-1}+...$，会有两种情况
1.$(2\lambda^{'}+\lambda) s(n) n^{d+d^{'}-1}+... en 0$，此时有$d = \deg(p(n)) - \deg(R(n)) + 1$
2.$(2\lambda^{'}+\lambda) s(n) n^{d+d^{'}-1}+... = 0$，此时有$d = \frac{2\lambda^{'}}{\lambda}$

这就解释了为什么要通过比较$Q(n)$和$R(n)$的次数来得到d了

到此就得到了完整的Gosper算法的原理

