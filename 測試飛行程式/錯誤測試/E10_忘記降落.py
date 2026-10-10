# 預期：可以飛，但出現黃色提醒「還在空中」
from djitellopy import Tello

tello = Tello()
tello.connect()
tello.takeoff()
tello.move_forward(100)
