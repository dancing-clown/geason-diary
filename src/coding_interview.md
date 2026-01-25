# 代码面试

## 算法实现

### 快速排序

基本思想：（分治）
先从数列中取出一个数作为key值；

将比这个数小的数全部放在它的左边，大于或等于它的数全部放在它的右边；

对左右两个小数列重复第二步，直至各区间只有1个数。

```cpp
template<typaname T>
void quickSort(vector<T> & arr, int left, int right) {
    if (left >= right) {
        return;
    }
    int i = left, j = right;
    T key = arr[left];
    while (i < j) {
        while (i < j && arr[j] >= key) {
            --j;
        }
        if (i < j) {
            arr[i] = arr[j];
            ++i;
        }
        while (i < j && arr[i] < key) {
            ++i;
        }
        if (i < j) {
            arr[j] = arr[i];
            --j;
        }
    }
    arr[i] = key;
    quickSort(arr, left, i - 1);
    quickSort(arr, i + 1, right);
}
```

### 插入排序

在要排序的一组数中，假定前n-1个数已经排好序，现在将第n个数插到前面的有序数列中，使得这n个数也是排好顺序的。如此反复循环，直到全部排好顺序。

```cpp
template<typaname T>
void insertionSort(vector<T> & arr) {
    for (int i = 1; i < arr.size(); ++i) {
        T key = arr[i];
        int j = i - 1;
        while (j >= 0 && arr[j] > key) {
            arr[j + 1] = arr[j];
            --j;
        }
        arr[j + 1] = key;
    }
}
```

### 选择排序

在长度为N的无序数组中，第一次遍历n-1个数，找到最小的数值与第一个元素交换；
第二次遍历n-2个数，找到最小的数值与第二个元素交换；

```cpp
template<typaname T>
void selectionSort(vector<T> & arr) {
    for (int i = 0; i < arr.size() - 1; ++i) {
        int minIndex = i;
        for (int j = i + 1; j < arr.size(); ++j) {
            if (arr[j] < arr[minIndex]) {
                minIndex = j;
            }
        }
        if (minIndex != i) {
            swap(arr[i], arr[minIndex]);
        }
    }
}
```

### 冒泡排序

两个数比较大小，较大的数下沉，较小的数冒起来。

```cpp
template<typaname T>
void bubbleSort(vector<T> & arr) {
    for (int i = arr.size() - 1; i >= 0; --i) {
        for (int j = 0; j < i; ++j) {
            if (arr[j] > arr[j + 1]) {
                swap(arr[j], arr[j + 1]);
            }
        }
    }
}
```

## 剑指offer

根据剑指offer题目来依次实现每个题目。

### 面试题3:二维数组的查找

题目：在一个二维数组中，每一行都按照从左到右递增的顺序排序，每一列都按照从上到下递增的顺序排序。请完成一个函数，输入这样的一个二维数组和一个整数，判断数组中是否含有该整数。

例如：

```bash
1 2 8 9
2 4 9 12
4 7 10 13
6 8 11 15
```

答案1：首先想到是二分查找，每一行可以执行一次二分查找，时间复杂度是O(mlogn)。

```cpp
// 二分查找
binary_search(a.begin(), a.end(), target)
// 大于等于
lower_bound(a.begin(), a.end(), target)
// 大于
upper_bound(a.begin(), a.end(), target)
```

```cpp
#include <iostream>
#include <vector>
#include <algorithm>

using namespace std;
bool Find(vector<vector<int>> matrix, int target) {
    for (auto row : matrix) {
        if (row[0] > target) {
            return false;
        }
        if (binary_search(row.begin(), row.end(), target) != row.end()) {
            return true;
        }
    }
    return false;
}
```

答案2: 思考(i,j)位置的值 和 target的关系。

- 如果target大于(i,j)位置的值，说明target在(i,j)位置的下方或右方，所以i++或j++
- 如果target小于(i,j)位置的值，说明target在(i,j)位置的上方或左方，所以i--或j--
- 如果target等于(i,j)位置的值，说明找到target，返回true

因此可以选择特殊的起点，来保证只有一个方向的变化，例如选左下角，如果target大于，则只能i++，如果target小于，则只能j--。复杂度O(m+n).

```cpp
bool Find(vector<vector<int>> matrix, int target) {
    int i = matrix.size() - 1;
    int j = 0;
    while (i >= 0 && j < matrix[0].size()) {
        if (target > matrix[i][j]) {
            j++;
        } else if (target < matrix[i][j]) {
            i--;
        } else {
            return true;
        }
    }
    return false;
}
```

### 面试题4: 替换空格

题目：请实现一个函数，将一个字符中的空格替换成"%20"。

例如："We are family" 替换后为"We%20are%20family"。

答案：如果单开一个新的空间做这个字符串，那么空间复杂度为2n。

如果需要在一个指针上做这个操作，那么需要从后往前做，否则会覆盖掉原来的字符。时间复杂度为O(n)。

因此可以使用读写指针均从后往前便利，其中读指针在前，写指针在后。写指针永远不回超过读指针。

```cpp
#include <iostream>
using namespace std;

void replaceSpace(char *str, int length) {
    int space_count = 0;
    for (int i = 0; i < length; ++i) {
        if (str[i] == ' ') {
            ++space_count;
        }
    }

    int len = length + space_count * 2;
    str[len] = '\0';
    int write = len - 1;
    for (int read = length - 1; i >= 0; --i) {
        if (str[read] == ' ') {
            str[write--] = '0';
            str[write--] = '2';
            str[write--] = '%';
        } else {
            str[write--] = str[read];
        }
    }
}
```

### 面试题5: 从尾到头打印链表

题目：输入一个链表，从尾到头打印链表每个节点的值，用数组返回。

例如：

```bash
1 -> 2 -> 3
# 输出
[3, 2, 1]
```

答案：可以使用栈来实现，或者回调函数

```cpp
#include <vector>
#include <iostream>
struct ListNode
{
    int val;
    ListNode *next;
};

vector<int> print_list(ListNode *head) {
    if (head == nullptr) {
        return {};
    }
    vector<int> res = print_list(head->next);
    res.push_back(head->val);
    return res;
}
```

### 面试题6: 重建二叉树

题目：输入某二叉树的前序遍历和中序遍历的结果，请重建出该二叉树。假设输入的前序遍历和中序遍历的结果中都不含重复的数字。
输入
前序遍历序列{1,2,4,7,3,5,6,8}
中序遍历序列{4,7,2,1,5,3,8,6}

则重建二叉树并返回。

答案：前序遍历为根左右，中序历遍为左根右。

```cpp
#include <vector>
#include <iostream>

struct Tree {
    int val;
    Tree *left;
    Tree *right;
};

Tree *build_tree(vector<int> &preorder, vector<int> &inorder, size_t pre_left, size_t pre_right, size_t in_left, size_t in_right) {
    if (pre_left == pre_right) {
        return nullptr;
    }
    Tree *root = new Tree(preorder[pre_left]);
    for (size_t i = in_left; i < in_right; ++i) {
        if (inorder[i] == preorder[pre_left]) {
            root->left = build_tree(preorder, inorder, pre_left + 1, pre_left + 1 + i - in_left, in_left, i);
            root->right = build_tree(preorder, inorder, pre_left + 1 + i - in_left, pre_right, i + 1, in_right);
            break;
        }
    }
    return root;
}

Tree *rebuild_tree(vector<int> preorder, vector<int> inorder) {
    if (preorder.empty()) {
        return nullptr;
    }
    return build_tree(preorder, inorder, 0, preorder.size(), 0, inorder.size());
}
```

### 面试题7: 用两个栈实现队列

题目：用两个栈来实现一个队列，完成队列的Push和Pop操作。

答案：一个栈用来Push，另一个栈用来Pop。

当Pop栈为空时，将Push栈中的元素全部弹出并压入Pop栈中。反之亦然

```cpp
#include <stack>
#include <iostream>

class Queue {
public:
    void push(int val) {
        // 元素转移
        while(!pop_stack.empty()) {
            push_stack.push(pop_stack.top());
            pop_stack.pop();
        }
        push_stack.push(val);
    }
    void pop() {
        // 元素转移
        while(!push_stack.empty()) {
            pop_stack.push(push_stack.top());
            push_stack.pop();
        }
        pop_stack.pop();
    }
private:
    std::stack<int> push_stack;
    std::stack<int> pop_stack;
};
```

### 面试题8: 旋转数组的最小数字

题目：把一个数组最开始的若干个元素搬到数组的末尾，我们称之为数组的旋转。输入一个非递减序列的一个旋转，输出旋转数组的最小元素。

比如`1 2 3 4 5`的一个旋转为`3 4 5 1 2`，输出最小元素为`1`。

答案：可以使用二分查找来实现，不过是动态缩小范围，不断取前半截和后半截的过程。另外注意中间元素mid = (left + right)/2 和 (left + right + 1)/2。

### 面试题33: 把数组排成最小的数

题目：输入一个正整数数组，把数组里所有数字拼接起来排成一个数，打印能拼接出的所有数字中最小的一个。

例如{3, 32, 321}

则打印出这三个数字能排出的最小数字为"321323".

答案：其实根据 a+b 和 b + a 来比较，哪个小就把哪个放在前面。

```cpp
#include <iostream>
#include <vector>
#include <string>
#include <algorithm>
std::string MinNumber(std::vector<std::string> nums) {
    std::sort(nums.begin(), nums.end(), [](const std::string &a, const std::string &b) {
        return a + b < b + a;
    });
    std::string res;
    for (const auto &num : nums) {
        res += num;
    }
    return res;
}
```

### 面试题34: 丑数

题目：把只包含因子2、3和5的数称作丑数（Ugly Number）。

例如6、8都是丑数，但14不是，因为它包含因子7。 习惯上我们把1当做是第一个丑数。求按从小到大的顺序的第N个丑数。

答案：可以使用动态规划来实现。

```cpp
#include <iostream>
#include <vector>

int UglyNumber(int n) {
    vector<int> dp(n+1);
    dp[1] = 1;
    int p2 = 1, p3 = 1, p5 = 1;
    for (int i = 2; i <= n; ++i) {
        int num2 = dp[p2] * 2, num3 = dp[p3] * 3, num5 = dp[p5] * 5;
        dp[i] = min({num2, num3, num5});
        if (dp[i] == num2) {
            ++p2;
        }
        if (dp[i] == num3) {
            ++p3;
        }
        if (dp[i] == num5) {
            ++p5;
        }
    }
    return dp[n];
}
```

### 面试题36：数组中的逆序对

题目：在数组中的两个数字，如果前面一个数字大于后面的数字，则这两个数字组成一个逆序对。输入一个数组，求出这个数组中的逆序对的总数。

例如

```bash
7 5 6 4
```

有(7, 5) (7, 6) (7, 4) (5, 4) (6, 4) 输出`5`。

答案：使用归并排序，通过Lp和Rp计算。

### 面试题37: 两个链表的第一个公共节点

题目：输入两个无环的单向链表，找到他们的第一个公共结点，如果没有则返回空。

答案：可以使用栈保存数据。也可以通过计算长度后，补充长度为较长链，然后同时判断节点是否相等。

```cpp
#include <stack>
#include <iostream>

using namespace std;
struct ListNode {
    int val;
    ListNode *next;
};

ListNode *FindFirstCommonNode(ListNode *l1, ListNode *l2) {
    stack<ListNode *> s1, s2;
    while (l1) {
        s1.push(l1);
        l1 = l1->next;
    }
    while (l2) {
        s2.push(l2);
        l2 = l2->next;
    }
    ListNode *res = nullptr;
    while (!s1.empty() && !s2.empty()) {
        if (s1.top() != s2.top()) {
            break;
        }
        res = s1.top();
        s1.pop();
        s2.pop();
    }
    return res;
}
```

### 面试题38: 和为sum的两个数

题目：输入一个递增排序的数组和一个数字s，在数组中查找两个数，得它们的和正好是s。如果有多对数字的和等于s，输出乘积最小的即可。

例如输入数组｛1、2、4、7、11、15 ｝和数字15。

由于4+11=15，因此输出4和11。

答案：可以使用binary_search。或者使用双指针。

若ai+aj==sum,即为答案。

若ai+aj>sum,则只能j-=1。

若ai+aj<sum,则只能i+=1。

### 查找和最小的K对数字

题目：给定两个以 非递减顺序排列 的整数数组 nums1 和 nums2 , 以及一个整数 k 。

定义一对值 (u,v)，其中第一个元素来自 nums1，第二个元素来自 nums2 。

请找到和最小的 k 个数对 (u1,v1),  (u2,v2)  ...  (uk,vk) 。

条件：1 <= nums1.length, nums2.length <= 10^5

-10^9 <= nums1[i], nums2[i] <= 10^9

nums1 和 nums2 均为 升序排列

1 <= k <= 10^4

k <= nums1.length * nums2.length

答案：这里的关键在于如何利用其有序性，如果把这个摊平为二维数组，其实就是找到前K个小的数对。

开始的思路是想用先找到第K个数的值是多少，然后在利用每列的二分查找，来完成所有数对的过滤。

进一步的，我们是否可以通过每列的元素作为起点，来判断后续的元素是否满足要求即可。

这里可以利用C++的优先级队列来完成。

```cpp
#include <iostream>
#include <queue>
#include <vector>
using namespace std;

vector<vector<int>> kSmallestPairs(vector<int>& nums1, vector<int>& nums2, int k) {
    auto cmp = [&nums1, &nums2](const pair<int, int> & a, const pair<int, int> & b) {
        return nums1[a.first] + nums2[a.second] > nums1[b.first] + nums2[b.second];
    };

    int m = nums1.size();
    int n = nums2.size();
    vector<vector<int>> ans;
    priority_queue<pair<int, int>, vector<pair<int, int>>, decltype(cmp)> pq(cmp);
    // 把每一行的头元素插入
    for (int i = 0; i < min(k, m); i++) {
        pq.emplace(i, 0);
    }

    // 尝试把这一列最小的元素统计进去
    // 然后将这一个最小的元素后面一个元素插入，这样就能保证其局部的最小
    while (k-- > 0 && !pq.empty()) {
        auto [x, y] = pq.top();
        pq.pop();
        ans.emplace_back(initializer_list<int>{nums1[x], nums2[y]});
        if (y + 1 < n) {
            pq.emplace(x, y + 1);
        }
    }

    return ans;
}

int main() {
    vector<int> nums1 = {1,7,11};
    vector<int> nums2 = {2,4,6};
    int k = 3;
    auto res = kSmallestPairs(nums1, nums2, k);
    for (auto &v : res) {
        cout << v[0] << " " << v[1] << endl;
    }
}
```
