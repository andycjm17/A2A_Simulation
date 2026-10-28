import itertools
import unittest
import numpy as np
from analyze import exact_sign_flip, holm, ranks, friedman_permutation


class AnalysisTests(unittest.TestCase):
    def test_exact_sign_flip(self):
        self.assertEqual(exact_sign_flip([1, 1, 1]), .25)
        self.assertEqual(exact_sign_flip([0, 0, 0]), 1)
        d = [3, -2, 7, 1]
        brute = [sum(s * x for s, x in zip(signs, d)) for signs in itertools.product((-1, 1), repeat=4)]
        self.assertEqual(exact_sign_flip(d), sum(abs(x) >= abs(sum(d)) for x in brute) / 16)

    def test_holm(self):
        np.testing.assert_allclose(holm([.01, .04, .03]), [.03, .06, .06])

    def test_rank_ties(self):
        np.testing.assert_allclose(ranks([30, 10, 10, 20]), [4, 1.5, 1.5, 3])

    def test_friedman_boundaries(self):
        same = friedman_permutation(np.ones((20, 10)), np.random.default_rng(1), 100)
        self.assertEqual(same['p'], 1)
        ordered = friedman_permutation(np.tile(np.arange(10), (20, 1)), np.random.default_rng(1), 100)
        self.assertAlmostEqual(ordered['statistic'], 180)
        self.assertAlmostEqual(ordered['kendall_w'], 1)


if __name__ == '__main__':
    unittest.main()
