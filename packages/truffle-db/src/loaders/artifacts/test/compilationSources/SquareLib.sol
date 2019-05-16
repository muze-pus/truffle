pragma solidity >=0.5.6;
pragma experimental ABIEncoderV2;

library SquareLib {
  struct MagicSquare {
    uint256[][] rows;
    uint256 n;
  }

  function initialize(uint256 n)
    external
    pure
    returns (MagicSquare memory square)
  {
    uint256 i;

    square = MagicSquare({
      rows: new uint256[][](n),
      n: n
    });

    for (i = 0; i < n; i++) {
      square.rows[i] = new uint256[](n);
    }
  }

  function step(
    MagicSquare memory square,
    uint256 x,
    uint256 y,
    uint256 i
  )
    internal
    pure
    returns (
      uint256 newX,
      uint256 newY,
      uint256 lastI
    )
  {
    if (square.rows[x][y] != 0) {
      newX = (x + 2) % square.n;
      newY = (square.n + y - 1) % square.n;
      lastI = i - 1;
      return (newX, newY, lastI);
    }

    square.rows[x][y] = i;
    newX = (square.n + x - 1) % square.n;
    newY = (y + 1) % square.n;
    lastI = i;
    return (newX, newY, lastI);
  }
}
