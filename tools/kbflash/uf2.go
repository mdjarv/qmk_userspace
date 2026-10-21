package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"os"
)

const (
	uf2Block   = 512
	uf2Payload = 32 // payload offset inside a block
)

// sparseUF2 copies a UF2 without its blank (all 0xFF) blocks, renumbering the
// rest. A full-flash backup is 16 MB and nearly all blank; writing only the
// data blocks after an erase gives the same flash in seconds.
func sparseUF2(src, dst string) (int, error) {
	data, err := os.ReadFile(src)
	if err != nil {
		return 0, err
	}
	if len(data)%uf2Block != 0 {
		return 0, fmt.Errorf("%s is not a UF2 file", src)
	}
	var kept [][]byte
	for i := 0; i < len(data); i += uf2Block {
		block := data[i : i+uf2Block]
		size := binary.LittleEndian.Uint32(block[16:20])
		if size > uf2Block-uf2Payload {
			return 0, fmt.Errorf("%s: bad block %d", src, i/uf2Block)
		}
		payload := block[uf2Payload : uf2Payload+size]
		if !bytes.Equal(payload, bytes.Repeat([]byte{0xff}, int(size))) {
			kept = append(kept, append([]byte(nil), block...))
		}
	}
	var out bytes.Buffer
	for n, block := range kept {
		binary.LittleEndian.PutUint32(block[20:24], uint32(n))         // blockNo
		binary.LittleEndian.PutUint32(block[24:28], uint32(len(kept))) // numBlocks
		out.Write(block)
	}
	return len(kept), os.WriteFile(dst, out.Bytes(), 0o644)
}
