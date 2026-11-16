# -*- coding: utf-8 -*-
# 解析 CRX3，提取公钥并计算 Chrome 扩展 ID
import hashlib, struct, sys

def read_varint(buf, pos):
    result = 0
    shift = 0
    while True:
        b = buf[pos]
        pos += 1
        result |= (b & 0x7F) << shift
        if not (b & 0x80):
            return result, pos
        shift += 7

def parse_fields(buf):
    """返回 [(field_number, wire_type, value_bytes_or_int)]"""
    out = []
    pos = 0
    while pos < len(buf):
        tag, pos = read_varint(buf, pos)
        fn = tag >> 3
        wt = tag & 7
        if wt == 0:
            v, pos = read_varint(buf, pos)
        elif wt == 2:
            ln, pos = read_varint(buf, pos)
            v = buf[pos:pos + ln]
            pos += ln
        elif wt == 5:
            v = buf[pos:pos + 4]; pos += 4
        elif wt == 1:
            v = buf[pos:pos + 8]; pos += 8
        else:
            raise ValueError('unsupported wire type %d' % wt)
        out.append((fn, wt, v))
    return out

path = sys.argv[1]
data = open(path, 'rb').read()
assert data[:4] == b'Cr24', 'not a CRX file'
version = struct.unpack('<I', data[4:8])[0]
header_size = struct.unpack('<I', data[8:12])[0]
print('CRX version:', version, ' header_size:', header_size)
header = data[12:12 + header_size]

pubkey = None
for fn, wt, val in parse_fields(header):
    if fn in (2, 3, 10) and wt == 2:      # AsymmetricKeyProof
        for f2, w2, v2 in parse_fields(val):
            if f2 == 1 and w2 == 2:        # public_key
                pubkey = v2
                break
    if pubkey:
        break

if not pubkey:
    print('public key NOT FOUND')
    sys.exit(1)

print('public key len:', len(pubkey))
digest = hashlib.sha256(pubkey).digest()[:16]
ext_id = ''.join(chr(ord('a') + (b >> 4)) + chr(ord('a') + (b & 0xF)) for b in digest)
print('EXTENSION ID:', ext_id)
