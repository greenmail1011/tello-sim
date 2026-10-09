# 預期：錯誤，無人機沒有在飛
from djitellopy import Tello

tello = Tello()
tello.connect()
tello.move_forward(100)
