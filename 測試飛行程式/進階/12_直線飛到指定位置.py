# go_xyz_speed：斜斜地飛到目標點再飛回來
from djitellopy import Tello

tello = Tello()
tello.connect()
tello.takeoff()

# 往「前 150、左 100、上 50」的位置直線飛過去，速度 40
tello.go_xyz_speed(150, 100, 50, 40)

# 再直線飛回來
tello.go_xyz_speed(-150, -100, -50, 40)
tello.land()
