"""Swap TabPFN's final scaled-dot-product-attention call for ORT's fused com.microsoft::MultiHeadAttention at export time.

Queries arrive already scaled by the model's softmax-scaling MLP, so MHA's default scale of 1/sqrt(head_dim) matches SDPA's.
Test rows use a single KV head (MQA); K/V are expanded to all heads so the contrib op (which needs equal head counts) applies.
In eager mode the Function runs plain SDPA, so the patched model stays numerically identical to the original."""
import torch
import torch.nn.functional as F
import tabpfn.architectures.tabpfn_v3_5 as arch

class _FusedMHA(torch.autograd.Function):
    @staticmethod
    def forward(ctx, q, k, v, num_heads):
        B, S, E = q.shape; L = k.shape[1]; d = E // num_heads
        qh, kh, vh = (t.view(B, -1, num_heads, d).transpose(1, 2) for t in (q, k, v))
        return F.scaled_dot_product_attention(qh, kh, vh).transpose(1, 2).reshape(B, S, E)

    @staticmethod
    def symbolic(g, q, k, v, num_heads):
        out = g.op("com.microsoft::MultiHeadAttention", q, k, v, num_heads_i=num_heads)
        out.setType(q.type())
        return out

def fused_sdpa(q_BSHD, k_BSJD, v_BSJD, _backends_override=None, *, quantized_kv=None, backend="auto"):
    B, S = q_BSHD.shape[0], q_BSHD.shape[1]
    H, D = int(q_BSHD.shape[2]), int(q_BSHD.shape[3])   # fixed by the model: plain ints, not traced values
    if int(k_BSJD.shape[2]) != H:                       # MQA/GQA: broadcast KV heads
        k_BSJD = k_BSJD.expand(-1, -1, H, -1); v_BSJD = v_BSJD.expand(-1, -1, H, -1)
    q3, k3, v3 = (t.reshape(B, t.shape[1], H * D) for t in (q_BSHD, k_BSJD, v_BSJD))
    return _FusedMHA.apply(q3, k3, v3, H).view(B, S, H, D)

def install():
    arch.scaled_dot_product_attention = fused_sdpa
